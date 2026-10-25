import { useVideoInfo } from '@/features/video'
import type { Input } from '@/features/video/types'
import { renderWithProviders, resetQueue, seedSession } from '@/test/test-utils'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DownloadButton from './DownloadButton'

// useVideoInfo is fully covered by its own tests; mock the hook so this
// suite controls only the inputs DownloadButton branches on.
vi.mock('@/features/video', () => ({
  useVideoInfo: vi.fn(),
}))

const emptyInput: Input = {
  url: 'https://www.bilibili.com/video/BV1xx411c7XD',
  partInputs: [],
  pendingDownload: null,
  batchSettings: { videoQuality: null, audioQuality: null, subtitle: null },
}

/** Builds a useVideoInfo return value with the "ready to download" defaults. */
function createMockUseVideoInfo(
  overrides: Partial<ReturnType<typeof useVideoInfo>> = {},
): ReturnType<typeof useVideoInfo> {
  return {
    download: vi.fn(),
    isForm1Valid: true,
    isForm2ValidAll: true,
    duplicateIndices: [],
    selectedCount: 1,
    input: emptyInput,
    ...overrides,
  } as ReturnType<typeof useVideoInfo>
}

describe('DownloadButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetQueue()
    vi.mocked(useVideoInfo).mockReturnValue(createMockUseVideoInfo())
  })

  it('is enabled when all validations pass and starts the download', async () => {
    const download = vi.fn()
    vi.mocked(useVideoInfo).mockReturnValue(
      createMockUseVideoInfo({ download }),
    )
    const { user: actor } = renderWithProviders(<DownloadButton />)

    const button = screen.getByRole('button', { name: 'actions.download' })
    expect(button).toBeEnabled()

    await actor.click(button)
    expect(download).toHaveBeenCalledTimes(1)
  })

  // The shortcut contract is a window-level keydown chord; dispatching
  // directly on window (fireEvent) keeps the test independent of focus
  // state, which the listener deliberately ignores.
  it('starts the download on Ctrl+Enter and shows the shortcut chips', () => {
    const download = vi.fn()
    vi.mocked(useVideoInfo).mockReturnValue(
      createMockUseVideoInfo({ download }),
    )
    renderWithProviders(<DownloadButton />)

    // Decorative Kbd chips render alongside the label…
    expect(screen.getByText('Ctrl')).toBeInTheDocument()
    expect(screen.getByText('Enter')).toBeInTheDocument()
    // …without polluting the accessible name.
    expect(
      screen.getByRole('button', { name: 'actions.download' }),
    ).toBeEnabled()

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })

    expect(download).toHaveBeenCalledTimes(1)
  })

  it('ignores Ctrl+Enter while validations fail', () => {
    const download = vi.fn()
    vi.mocked(useVideoInfo).mockReturnValue(
      createMockUseVideoInfo({ download, isForm1Valid: false }),
    )
    renderWithProviders(<DownloadButton />)

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })

    expect(download).not.toHaveBeenCalled()
  })

  it('ignores plain Enter', () => {
    const download = vi.fn()
    vi.mocked(useVideoInfo).mockReturnValue(
      createMockUseVideoInfo({ download }),
    )
    renderWithProviders(<DownloadButton />)

    fireEvent.keyDown(window, { key: 'Enter' })

    expect(download).not.toHaveBeenCalled()
  })

  it('ignores ⌘+Enter: the modifier is Ctrl-only on every platform', () => {
    const download = vi.fn()
    vi.mocked(useVideoInfo).mockReturnValue(
      createMockUseVideoInfo({ download }),
    )
    renderWithProviders(<DownloadButton />)

    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })

    expect(download).not.toHaveBeenCalled()
  })

  it('stops listening on unmount: the listener dies with the button', () => {
    const download = vi.fn()
    vi.mocked(useVideoInfo).mockReturnValue(
      createMockUseVideoInfo({ download }),
    )
    const { unmount } = renderWithProviders(<DownloadButton />)

    unmount()
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })

    expect(download).not.toHaveBeenCalled()
  })

  it('tracks the disabled state across rerenders (no stale listener)', () => {
    const download = vi.fn()
    vi.mocked(useVideoInfo).mockReturnValue(
      createMockUseVideoInfo({ download }),
    )
    // The component consumes no store/router context directly, so a
    // bare rerender is safe (RTL rerender drops renderWithProviders).
    const { rerender } = renderWithProviders(<DownloadButton />)

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(download).toHaveBeenCalledTimes(1)

    vi.mocked(useVideoInfo).mockReturnValue(
      createMockUseVideoInfo({ download, isForm1Valid: false }),
    )
    rerender(<DownloadButton />)
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(download).toHaveBeenCalledTimes(1)

    vi.mocked(useVideoInfo).mockReturnValue(
      createMockUseVideoInfo({ download }),
    )
    rerender(<DownloadButton />)
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(download).toHaveBeenCalledTimes(2)
  })

  it('swallows the browser default for the chord only, not other keys', () => {
    vi.mocked(useVideoInfo).mockReturnValue(createMockUseVideoInfo())
    renderWithProviders(<DownloadButton />)

    // fireEvent returns dispatchEvent's result: false when a cancelable
    // event's default was prevented. The chord must not double-fire via
    // native Enter activation (e.g. a focused button); other keys keep
    // their default for the rest of the page.
    expect(fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })).toBe(
      false,
    )
    expect(fireEvent.keyDown(window, { key: 'Enter' })).toBe(true)
  })

  it('stays enabled and keeps the idle label while a queue session runs (issue #691)', () => {
    // Downloads no longer lock the button — clicking enqueues another
    // session; the duplicate guard at enqueue time handles conflicts.
    seedSession('BVbtn1', [{ partIndex: 1, cid: 1, status: 'running' }])

    renderWithProviders(<DownloadButton />)

    expect(
      screen.getByRole('button', { name: 'actions.download' }),
    ).toBeEnabled()
  })

  it('is enabled once every enqueued part is done', () => {
    seedSession('BVbtn2', [{ partIndex: 1, cid: 1, status: 'done' }])

    renderWithProviders(<DownloadButton />)

    expect(
      screen.getByRole('button', { name: 'actions.download' }),
    ).toBeEnabled()
  })

  it('is disabled when the URL form is invalid', () => {
    vi.mocked(useVideoInfo).mockReturnValue(
      createMockUseVideoInfo({ isForm1Valid: false }),
    )

    renderWithProviders(<DownloadButton />)

    expect(
      screen.getByRole('button', { name: 'actions.download' }),
    ).toBeDisabled()
  })

  it('is disabled when the part-settings form is invalid', () => {
    vi.mocked(useVideoInfo).mockReturnValue(
      createMockUseVideoInfo({ isForm2ValidAll: false }),
    )

    renderWithProviders(<DownloadButton />)

    expect(
      screen.getByRole('button', { name: 'actions.download' }),
    ).toBeDisabled()
  })
})
