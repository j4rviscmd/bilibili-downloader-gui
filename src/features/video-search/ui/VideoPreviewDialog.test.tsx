import { logger } from '@/shared/lib/logger'
import { emitTauriEvent } from '@/test/tauriEvents'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VideoSearchEntry } from '../types'
import { VideoPreviewDialog } from './VideoPreviewDialog'

// hls.js needs MSE, which the test environment lacks; mock the class so
// the MSE branch is exercised deterministically and the native branch is
// selected by flipping isSupported below.
const hlsState = vi.hoisted(() => ({
  supported: true,
  destroyed: 0,
  loadedSrc: [] as string[],
  attached: 0,
  configs: [] as Record<string, unknown>[],
  attachedData: [] as unknown[],
  errorHandlers: [] as ((
    event: unknown,
    data: { fatal: boolean; type: string; details: string },
  ) => void)[],
}))

vi.mock('hls.js', () => {
  class Hls {
    static Events = { ERROR: 'hlsError' }
    constructor(config: Record<string, unknown>) {
      hlsState.configs.push(config)
    }
    static isSupported() {
      return hlsState.supported
    }
    on(event: string, handler: never) {
      if (event === 'hlsError') hlsState.errorHandlers.push(handler)
    }
    loadSource(src: string) {
      hlsState.loadedSrc.push(src)
    }
    attachMedia(data: unknown) {
      hlsState.attached += 1
      hlsState.attachedData.push(data)
    }
    destroy() {
      hlsState.destroyed += 1
    }
  }
  return { default: Hls }
})

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

const session = (token: string, durationSec = 120, cappedAtSec = 120) => ({
  token,
  playlist: `hls/${token}/playlist.m3u8`,
  durationSec,
  cappedAtSec,
})

const CONVERTED = 'http://stream.localhost/hls%2Fs1%2Fplaylist.m3u8'

describe('VideoPreviewDialog (HLS sessions)', () => {
  // Reset BEFORE each test: RTL's auto-cleanup afterEach unmounts the
  // previous dialog AFTER this file's hooks run, so an afterEach reset
  // would be polluted by that late unmount (destroy counts/loose effects).
  beforeEach(() => {
    hlsState.supported = true
    hlsState.destroyed = 0
    hlsState.loadedSrc = []
    hlsState.attached = 0
    hlsState.configs = []
    hlsState.errorHandlers = []
    // Clear call history (keeps per-test implementations queued after
    // this hook runs); without it the cross-test open/close calls stack.
    mockInvoke.mockClear()
    vi.restoreAllMocks()
  })

  it('attaches hls.js to the stream:// playlist for the resolved session', async () => {
    mockInvoke.mockResolvedValue(session('s1'))
    renderWithProviders(<VideoPreviewDialog entry={entry} onClose={() => {}} />)

    await waitFor(() => {
      expect(hlsState.loadedSrc).toEqual([CONVERTED])
    })
    expect(hlsState.attached).toBe(1)
    // The control-bar total is pinned to the preview's fixed content
    // length: EVENT playlists report a growing duration, so without the
    // override the denominator stretched during generation.
    expect(hlsState.attachedData[0]).toMatchObject({
      overrides: { duration: 120 },
    })
    // The playlist appears only after ffmpeg writes its first segment:
    // the manifest retry POLICY must span that warm-up (hls.js 1.x
    // ignores the legacy manifestLoading* numbers; defaults go fatal in
    // ~1s — the second verification round's failure).
    expect(hlsState.configs[0]).toMatchObject({
      manifestLoadPolicy: {
        default: {
          errorRetry: {
            maxNumRetry: 42,
            retryDelayMs: 700,
          },
        },
      },
    })
    expect(mockInvoke).toHaveBeenCalledWith('open_preview_session', {
      bvid: 'BV1De411p77r',
    })
  })

  it('falls back to the native HLS element path when MSE is unsupported', async () => {
    hlsState.supported = false
    mockInvoke.mockResolvedValue(session('s1'))
    renderWithProviders(<VideoPreviewDialog entry={entry} onClose={() => {}} />)

    const video = await waitFor(() => {
      const el = document.querySelector('video')
      expect(el).not.toBeNull()
      return el as HTMLVideoElement
    })
    await waitFor(() => {
      expect(video).toHaveAttribute('src', CONVERTED)
    })
    expect(hlsState.loadedSrc).toEqual([])
  })

  it('jumps back to zero on the first playing (EVENT playlists start at the edge)', async () => {
    mockInvoke.mockResolvedValue(session('s1'))
    renderWithProviders(<VideoPreviewDialog entry={entry} onClose={() => {}} />)

    const video = await waitFor(() => {
      const el = document.querySelector('video')
      expect(el).not.toBeNull()
      return el as HTMLVideoElement
    })
    // Simulate hls.js having started near the generation edge.
    Object.defineProperty(video, 'currentTime', {
      value: 54,
      writable: true,
      configurable: true,
    })
    fireEvent.playing(video)
    expect(video.currentTime).toBe(0)

    // A later playing (e.g. after a seek) must not force zero again.
    video.currentTime = 30
    fireEvent.playing(video)
    expect(video.currentTime).toBe(30)
  })

  it('shows the generation-progress badge while the session generates', async () => {
    mockInvoke.mockResolvedValue(session('s1', 600, 600))
    renderWithProviders(<VideoPreviewDialog entry={entry} onClose={() => {}} />)
    await waitFor(() => {
      expect(hlsState.loadedSrc).toEqual([CONVERTED])
    })

    emitTauriEvent('preview-hls-progress', { token: 's1', currentSec: 150 })
    expect(
      await screen.findByText('videoSearch.previewGenerating'),
    ).toBeInTheDocument()

    // Completion clears the badge (generation finished).
    emitTauriEvent('preview-hls-completed', 's1')
    await waitFor(() => {
      expect(
        screen.queryByText('videoSearch.previewGenerating'),
      ).not.toBeInTheDocument()
    })
  })

  it('ignores progress events for another session token', async () => {
    mockInvoke.mockResolvedValue(session('s1', 600, 600))
    renderWithProviders(<VideoPreviewDialog entry={entry} onClose={() => {}} />)
    await waitFor(() => {
      expect(hlsState.loadedSrc).toEqual([CONVERTED])
    })

    // A late progress tick from the previous session (entry switch) must
    // not drive the new session's badge.
    emitTauriEvent('preview-hls-progress', { token: 'other', currentSec: 150 })
    await waitFor(() => {
      expect(
        screen.queryByText('videoSearch.previewGenerating'),
      ).not.toBeInTheDocument()
    })
  })

  it('hides the generation badge once progress reaches the cap', async () => {
    mockInvoke.mockResolvedValue(session('s1', 600, 600))
    renderWithProviders(<VideoPreviewDialog entry={entry} onClose={() => {}} />)
    await waitFor(() => {
      expect(hlsState.loadedSrc).toEqual([CONVERTED])
    })

    emitTauriEvent('preview-hls-progress', { token: 's1', currentSec: 150 })
    expect(
      await screen.findByText('videoSearch.previewGenerating'),
    ).toBeInTheDocument()

    // Generation reached the cap: the "generating" state is over, so the
    // badge must clear on its own (not sit at 100% until ENDLIST).
    emitTauriEvent('preview-hls-progress', { token: 's1', currentSec: 600 })
    await waitFor(() => {
      expect(
        screen.queryByText('videoSearch.previewGenerating'),
      ).not.toBeInTheDocument()
    })
  })

  it('shows the cap badge for videos longer than the generation limit', async () => {
    mockInvoke.mockResolvedValue(session('s1', 5000, 900))
    renderWithProviders(<VideoPreviewDialog entry={entry} onClose={() => {}} />)

    expect(
      await screen.findByText('videoSearch.previewCapped'),
    ).toBeInTheDocument()
  })

  it('retries once on a fatal hls error, then shows the failure UI', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    // Distinct tokens per open: React bails out on an identical state
    // reference, and a real retry always resolves a fresh session.
    let openCalls = 0
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd !== 'open_preview_session') return Promise.resolve(undefined)
      openCalls += 1
      return Promise.resolve(session(openCalls === 1 ? 's1' : 's2'))
    })
    renderWithProviders(<VideoPreviewDialog entry={entry} onClose={() => {}} />)
    await waitFor(() => {
      expect(hlsState.errorHandlers.length).toBe(1)
    })

    hlsState.errorHandlers[0](
      {},
      { fatal: true, type: 'mediaError', details: 'bufferStalledError' },
    )
    await waitFor(() => {
      expect(
        mockInvoke.mock.calls.filter(([cmd]) => cmd === 'open_preview_session'),
      ).toHaveLength(2)
    })

    // The retry session re-attaches hls.js; a second fatal error is final.
    await waitFor(() => {
      expect(hlsState.errorHandlers.length).toBe(2)
    })
    hlsState.errorHandlers[1](
      {},
      { fatal: true, type: 'mediaError', details: 'bufferStalledError' },
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'videoSearch.previewPlaybackError',
    )
    expect(document.querySelector('video')).toBeNull()
  })

  it('retries once on a backend remux failure, then shows the failure UI', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    // Distinct tokens per open (see the fatal-hls retry test above).
    let openCalls = 0
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd !== 'open_preview_session') return Promise.resolve(undefined)
      openCalls += 1
      return Promise.resolve(session(openCalls === 1 ? 's1' : 's2'))
    })
    renderWithProviders(<VideoPreviewDialog entry={entry} onClose={() => {}} />)
    await waitFor(() => {
      expect(hlsState.loadedSrc).toEqual([CONVERTED])
    })

    // ffmpeg died (rotation exhausted): the backend reports it for the live
    // token, which drives the same one-shot retry as a player failure.
    emitTauriEvent('preview-hls-error', 's1')
    await waitFor(() => {
      expect(hlsState.loadedSrc).toEqual([
        CONVERTED,
        'http://stream.localhost/hls%2Fs2%2Fplaylist.m3u8',
      ])
    })

    // The retry session fails too — the failure UI replaces the player.
    emitTauriEvent('preview-hls-error', 's2')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'videoSearch.previewPlaybackError',
    )
    expect(document.querySelector('video')).toBeNull()
  })

  it('closes the session and destroys the player on unmount', async () => {
    mockInvoke.mockResolvedValue(session('s1'))
    const { unmount } = renderWithProviders(
      <VideoPreviewDialog entry={entry} onClose={() => {}} />,
    )
    await waitFor(() => {
      expect(hlsState.loadedSrc).toEqual([CONVERTED])
    })

    unmount()
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('close_preview_session', {
        token: 's1',
      })
    })
    expect(hlsState.destroyed).toBe(1)
  })

  it('maps the ffmpeg-missing error to its dedicated message', async () => {
    mockInvoke.mockRejectedValue('ERR::PREVIEW_FFMPEG_MISSING')
    renderWithProviders(<VideoPreviewDialog entry={entry} onClose={() => {}} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'videoSearch.previewFfmpegMissing',
    )
    expect(document.querySelector('video')).toBeNull()
  })
})
