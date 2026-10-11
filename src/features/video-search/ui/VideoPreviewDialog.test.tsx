import { store } from '@/app/store'
import {
  emitTauriEvent,
  mockInvoke,
  renderWithProviders,
} from '@/test/test-utils'
import { openUrl } from '@tauri-apps/plugin-opener'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoSearchEntry } from '../types'
import { VideoPreviewDialog } from './VideoPreviewDialog'

const entry: VideoSearchEntry = {
  bvid: 'BV1De411p77r',
  title: 'テスト動画',
  cover: '',
  author: 'up',
  play: 1,
  duration: 287,
  typeid: '193',
  typename: 'MV',
}

/** jsdom rects are all zeros — stub a real viewport rect for the
 * placeholder so the asserted payloads carry non-zero geometry. */
function stubRect(x: number, y: number, width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    bottom: y + height,
    right: x + width,
    toJSON: () => ({}),
  } as DOMRect)
}

/** The dialog is always mounted by its parent — rerender needs the same
 * providers around it (RTL rerender replaces the whole tree). */
const wrapped = (el: ReactElement) => (
  <Provider store={store}>
    <MemoryRouter>{el}</MemoryRouter>
  </Provider>
)

/** Minimal ResizeObserver stand-in: jsdom ships none, so the effect's
 * feature guard would skip registration and the sync path went
 * untested. Instances are recorded so tests can fire the callback. */
class MockResizeObserver {
  static instances: MockResizeObserver[] = []
  callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    MockResizeObserver.instances.push(this)
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const openCalls = () =>
  mockInvoke.mock.calls.filter(([cmd]) => cmd === 'open_preview_player')
const closeCalls = () =>
  mockInvoke.mock.calls.filter(([cmd]) => cmd === 'close_preview_player')
const syncCalls = () =>
  mockInvoke.mock.calls.filter(([cmd]) => cmd === 'sync_preview_player')

describe('VideoPreviewDialog (official embed overlay)', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue(undefined)
    MockResizeObserver.instances = []
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('opens the overlay with the placeholder rect after layout settles', async () => {
    stubRect(48, 120, 800, 450)
    renderWithProviders(<VideoPreviewDialog entry={entry} onClose={() => {}} />)

    await waitFor(() => {
      expect(openCalls()).toHaveLength(1)
    })
    expect(openCalls()[0]).toEqual([
      'open_preview_player',
      {
        bvid: 'BV1De411p77r',
        rect: { x: 48, y: 120, width: 800, height: 450 },
      },
    ])
    // The player lives in its own overlay window — no <video> here.
    expect(document.querySelector('video')).toBeNull()
  })

  it('closes the overlay when the entry goes null (dialog closed)', async () => {
    stubRect(48, 120, 800, 450)
    const { rerender } = render(
      wrapped(<VideoPreviewDialog entry={entry} onClose={() => {}} />),
    )
    await waitFor(() => {
      expect(openCalls()).toHaveLength(1)
    })
    mockInvoke.mockClear()

    rerender(wrapped(<VideoPreviewDialog entry={null} onClose={() => {}} />))
    await waitFor(() => {
      expect(closeCalls()).toHaveLength(1)
    })
  })

  it('closes the overlay on unmount with a preview still open', async () => {
    stubRect(48, 120, 800, 450)
    const { unmount } = render(
      wrapped(<VideoPreviewDialog entry={entry} onClose={() => {}} />),
    )
    await waitFor(() => {
      expect(openCalls()).toHaveLength(1)
    })
    mockInvoke.mockClear()

    unmount()
    await waitFor(() => {
      expect(closeCalls()).toHaveLength(1)
    })
  })

  it('shows an error message when opening fails', async () => {
    stubRect(48, 120, 800, 450)
    mockInvoke.mockRejectedValue(new Error('ERR::PREVIEW_NO_MAIN_WINDOW'))
    renderWithProviders(<VideoPreviewDialog entry={entry} onClose={() => {}} />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
  })

  it('syncs the overlay when the placeholder resizes (debounced)', async () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    stubRect(48, 120, 800, 450)
    renderWithProviders(<VideoPreviewDialog entry={entry} onClose={() => {}} />)
    await waitFor(() => {
      expect(openCalls()).toHaveLength(1)
    })
    mockInvoke.mockClear()

    stubRect(48, 120, 640, 360)
    const observer = MockResizeObserver.instances.at(-1)
    expect(observer).toBeDefined()

    vi.useFakeTimers()
    act(() => {
      observer!.callback([], {} as ResizeObserver)
    })
    vi.advanceTimersByTime(100)

    expect(syncCalls()).toHaveLength(1)
    expect(syncCalls()[0]).toEqual([
      'sync_preview_player',
      { rect: { x: 48, y: 120, width: 640, height: 360 } },
    ])
  })

  it('closes the dialog when the overlay window is closed directly', async () => {
    stubRect(48, 120, 800, 450)
    const onClose = vi.fn()
    renderWithProviders(<VideoPreviewDialog entry={entry} onClose={onClose} />)
    await waitFor(() => {
      expect(openCalls()).toHaveLength(1)
    })

    // Alt+F4 on the player window → backend emits preview-player-closed.
    await act(async () => {
      emitTauriEvent('preview-player-closed', null)
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('pauses the overlay instead of closing it when opening in browser', async () => {
    stubRect(48, 120, 800, 450)
    const onClose = vi.fn()
    const { user } = renderWithProviders(
      <VideoPreviewDialog entry={entry} onClose={onClose} />,
    )
    await waitFor(() => {
      expect(openCalls()).toHaveLength(1)
    })
    mockInvoke.mockClear()

    // i18n is identity-mocked in tests (setup.ts) — the accessible
    // name is the raw translation key.
    await user.click(
      screen.getByRole('button', { name: 'videoSearch.previewOpenInBrowser' }),
    )

    // The dialog stays up: no close command, no onClose — the overlay
    // is paused and the handoff goes to the browser.
    expect(onClose).not.toHaveBeenCalled()
    expect(closeCalls()).toHaveLength(0)
    const pauseCalls = mockInvoke.mock.calls.filter(
      ([cmd]) => cmd === 'pause_preview_player',
    )
    expect(pauseCalls).toHaveLength(1)
    expect(openUrl).toHaveBeenCalledWith(
      'https://www.bilibili.com/video/BV1De411p77r',
    )
  })

  it('still opens the browser when pausing the overlay fails (fail-soft)', async () => {
    stubRect(48, 120, 800, 450)
    const onClose = vi.fn()
    const { user } = renderWithProviders(
      <VideoPreviewDialog entry={entry} onClose={onClose} />,
    )
    await waitFor(() => {
      expect(openCalls()).toHaveLength(1)
    })
    mockInvoke.mockClear()
    // The overlay died between the click and the pause command: the
    // backend rejects (ERR::PREVIEW_NO_OVERLAY-style failure) and the
    // catch must swallow it so the handoff is not blocked.
    mockInvoke.mockRejectedValueOnce(new Error('ERR::PREVIEW_NO_OVERLAY'))

    await user.click(
      screen.getByRole('button', { name: 'videoSearch.previewOpenInBrowser' }),
    )

    // Fail soft: the browser still opens, the dialog stays up, and no
    // error alert surfaces (vitest also fails on the unhandled
    // rejection a dropped .catch would produce).
    await waitFor(() => {
      expect(openUrl).toHaveBeenCalledWith(
        'https://www.bilibili.com/video/BV1De411p77r',
      )
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(closeCalls()).toHaveLength(0)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('fires no commands when mounted with no entry (always-mounted gate)', async () => {
    stubRect(48, 120, 800, 450)
    renderWithProviders(<VideoPreviewDialog entry={null} onClose={() => {}} />)

    // Drain the microtask queue: a wrongly-scheduled close command
    // (dropped hadEntryRef gate) would land here.
    await act(async () => {})
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('coalesces a resize burst into one sync carrying the latest rect', async () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    stubRect(48, 120, 800, 450)
    renderWithProviders(<VideoPreviewDialog entry={entry} onClose={() => {}} />)
    await waitFor(() => {
      expect(openCalls()).toHaveLength(1)
    })
    mockInvoke.mockClear()

    // Two resize entries inside the debounce window: one drag, not two
    // set_position round-trips.
    stubRect(48, 120, 700, 394)
    const observer = MockResizeObserver.instances.at(-1)!
    vi.useFakeTimers()
    act(() => {
      observer.callback([], {} as ResizeObserver)
    })
    stubRect(48, 120, 640, 360)
    act(() => {
      observer.callback([], {} as ResizeObserver)
    })
    vi.advanceTimersByTime(100)

    expect(syncCalls()).toHaveLength(1)
    expect(syncCalls()[0]).toEqual([
      'sync_preview_player',
      { rect: { x: 48, y: 120, width: 640, height: 360 } },
    ])
  })

  it('re-syncs on viewport resize when only the placeholder moved (size-capped recenter)', async () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    stubRect(333, 130, 1077, 605)
    renderWithProviders(<VideoPreviewDialog entry={entry} onClose={() => {}} />)
    await waitFor(() => {
      expect(openCalls()).toHaveLength(1)
    })
    mockInvoke.mockClear()

    // Main window resized: the dialog recenters the placeholder while its
    // size caps keep it 1077x605, so ResizeObserver never fires. The
    // viewport resize event must carry the fresh rect — the overlay used to
    // stay glued to the stale one and render offset from the dialog.
    stubRect(741.7, 376.1, 1077, 605)
    vi.useFakeTimers()
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    vi.advanceTimersByTime(100)

    expect(syncCalls()).toHaveLength(1)
    expect(syncCalls()[0]).toEqual([
      'sync_preview_player',
      { rect: { x: 741.7, y: 376.1, width: 1077, height: 605 } },
    ])
  })

  it('coalesces a viewport resize with observer entries into one sync (shared schedule)', async () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    stubRect(48, 120, 800, 450)
    renderWithProviders(<VideoPreviewDialog entry={entry} onClose={() => {}} />)
    await waitFor(() => {
      expect(openCalls()).toHaveLength(1)
    })
    mockInvoke.mockClear()

    // A real window resize can push the placeholder past its size caps in
    // the same interaction: the observer and the viewport listener both
    // fire inside one debounce window. Sharing `schedule` must collapse
    // them into a single set_position carrying the latest rect.
    stubRect(160, 200, 640, 360)
    const observer = MockResizeObserver.instances.at(-1)!
    vi.useFakeTimers()
    act(() => {
      observer.callback([], {} as ResizeObserver)
      window.dispatchEvent(new Event('resize'))
    })
    vi.advanceTimersByTime(100)

    expect(syncCalls()).toHaveLength(1)
    expect(syncCalls()[0]).toEqual([
      'sync_preview_player',
      { rect: { x: 160, y: 200, width: 640, height: 360 } },
    ])
  })

  it('drops a pending debounced sync when the entry goes null first', async () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    stubRect(48, 120, 800, 450)
    const { rerender } = render(
      wrapped(<VideoPreviewDialog entry={entry} onClose={() => {}} />),
    )
    await waitFor(() => {
      expect(openCalls()).toHaveLength(1)
    })
    mockInvoke.mockClear()

    vi.useFakeTimers()
    act(() => {
      MockResizeObserver.instances.at(-1)!.callback([], {} as ResizeObserver)
    })
    // Dialog closes before the debounce elapses: the cleanup must clear
    // the pending timer so no stale geometry sync lands after the close.
    rerender(wrapped(<VideoPreviewDialog entry={null} onClose={() => {}} />))
    vi.advanceTimersByTime(200)

    expect(syncCalls()).toHaveLength(0)
    expect(closeCalls()).toHaveLength(1)
  })

  it('drops a pending viewport-resize sync and detaches the listener on close', async () => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    stubRect(48, 120, 800, 450)
    const { rerender } = render(
      wrapped(<VideoPreviewDialog entry={entry} onClose={() => {}} />),
    )
    await waitFor(() => {
      expect(openCalls()).toHaveLength(1)
    })
    mockInvoke.mockClear()

    vi.useFakeTimers()
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    // Dialog closes before the debounce elapses: the cleanup must clear
    // the pending timer AND remove the viewport listener, or later
    // resizes keep syncing a stale rect over the closed overlay.
    rerender(wrapped(<VideoPreviewDialog entry={null} onClose={() => {}} />))
    vi.advanceTimersByTime(200)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    vi.advanceTimersByTime(200)

    expect(syncCalls()).toHaveLength(0)
    expect(closeCalls()).toHaveLength(1)
  })

  it('clears the error when a later open succeeds', async () => {
    stubRect(48, 120, 800, 450)
    mockInvoke.mockRejectedValueOnce(new Error('ERR::PREVIEW_NO_MAIN_WINDOW'))
    const { rerender } = render(
      wrapped(<VideoPreviewDialog entry={entry} onClose={() => {}} />),
    )
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })

    // Close, then preview again with the backend healthy: the stale
    // error must not blank the second attempt.
    rerender(wrapped(<VideoPreviewDialog entry={null} onClose={() => {}} />))
    rerender(wrapped(<VideoPreviewDialog entry={entry} onClose={() => {}} />))

    await waitFor(() => {
      expect(openCalls()).toHaveLength(2)
    })
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })

  it('drops the superseded open when the entry switches before layout settles', async () => {
    stubRect(48, 120, 800, 450)
    // Capture rAF callbacks instead of running them: the switch happens
    // while A's double-rAF chain is still queued.
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal(
      'requestAnimationFrame',
      (cb: FrameRequestCallback): number => {
        frames.push(cb)
        return frames.length
      },
    )
    const entryB: VideoSearchEntry = { ...entry, bvid: 'BV1De411p77s' }
    const { rerender } = render(
      wrapped(<VideoPreviewDialog entry={entry} onClose={() => {}} />),
    )
    rerender(wrapped(<VideoPreviewDialog entry={entryB} onClose={() => {}} />))

    // Drain every queued frame (both double-rAF chains): only B's open
    // may fire — A's cancellation flag must drop its pending open.
    await act(async () => {
      while (frames.length > 0) {
        frames.shift()!(performance.now())
        await Promise.resolve()
      }
    })

    expect(openCalls()).toHaveLength(1)
    expect(openCalls()[0][1]).toMatchObject({ bvid: 'BV1De411p77s' })
    expect(closeCalls()).toHaveLength(0)
  })
})
