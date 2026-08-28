/**
 * ListenerContext suite.
 *
 * The provider wires 7 Tauri events into the real singleton store. Tests
 * drive the globally mocked `@tauri-apps/api/event` through the in-memory
 * bus (emitTauriEvent) and assert Redux state; toast content is asserted
 * via a local toast spy.
 */

import { store } from '@/app/store'
import { clearHistory } from '@/features/history/model/historySlice'
import { initPartInputs, resetInput } from '@/features/video/model/inputSlice'
import {
  clearProgress,
  selectProgressEntriesByDownloadId,
} from '@/shared/progress/progressSlice'
import { clearQueue, enqueue } from '@/shared/queue/queueSlice'
import { toast } from '@/shared/ui/toast'
import { clearTauriEvents, emitTauriEvent } from '@/test/tauriEvents'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ListenerProvider } from './ListenerContext'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

// i18n: the provider calls the raw i18n.t on the @/i18n singleton; the
// centralized setup mock provides identity t with {{var}} interpolation.
const progressBase = {
  downloadId: 'd1',
  filesize: 10,
  downloaded: 1,
  transferRate: 1024,
  percentage: 10,
  deltaTime: 0.5,
  elapsedTime: 1,
  isComplete: false,
}

function queue() {
  return store.getState().queue
}

async function mount() {
  const utils = render(<ListenerProvider>probe</ListenerProvider>)
  // setupListeners is async: wait until the bus registered all handlers
  await waitFor(() => {
    emitTauriEvent('download-retrying', {
      downloadId: 'noop',
      isRetrying: false,
    })
  })
  return utils
}

beforeEach(async () => {
  // Unmount any provider still mounted from the previous test BEFORE
  // clearing state, so its listeners stop firing into the fresh state.
  cleanup()
  clearTauriEvents()
  store.dispatch(clearQueue())
  store.dispatch(clearProgress())
  store.dispatch(resetInput())
  store.dispatch(clearHistory())
  vi.clearAllMocks()
})

afterEach(() => {
  clearTauriEvents()
})

describe('progress event', () => {
  it('dispatches setProgress and marks running on download stages', async () => {
    await mount()
    store.dispatch(enqueue({ downloadId: 'd1', status: 'pending' }))

    act(() => {
      emitTauriEvent('progress', { ...progressBase, stage: 'audio' })
    })

    expect(
      selectProgressEntriesByDownloadId('d1')(store.getState()),
    ).toHaveLength(1)
    expect(queue().find((q) => q.downloadId === 'd1')!.status).toBe('running')
  })

  it('marks done on complete stage', async () => {
    await mount()
    store.dispatch(enqueue({ downloadId: 'd1', status: 'running' }))

    act(() => {
      emitTauriEvent('progress', { ...progressBase, stage: 'complete' })
    })

    expect(queue().find((q) => q.downloadId === 'd1')!.status).toBe('done')
  })

  it('unknown stage leaves queue status untouched', async () => {
    await mount()
    store.dispatch(enqueue({ downloadId: 'd1', status: 'pending' }))

    act(() => {
      emitTauriEvent('progress', { ...progressBase, stage: 'finalize' })
    })

    expect(queue().find((q) => q.downloadId === 'd1')!.status).toBe('pending')
  })

  it('merge-fallback stage shows the audio-merge-fallback toast', async () => {
    await mount()
    act(() => {
      emitTauriEvent('progress', { ...progressBase, stage: 'merge-fallback' })
    })
    expect(toast.info).toHaveBeenCalledWith('video.audio_merge_fallback', {
      duration: 6000,
    })
  })

  it.each(['warn-video-quality-fallback', 'warn-audio-quality-fallback'])(
    '%s shows the matching warning toast',
    async (stage) => {
      await mount()
      act(() => {
        emitTauriEvent('progress', { ...progressBase, stage })
      })
      expect(toast.warning).toHaveBeenCalledWith(
        stage.startsWith('warn-video')
          ? 'video.video_quality_fallback'
          : 'video.audio_quality_fallback',
        { duration: 6000 },
      )
    },
  )
})

describe('history:entry_added', () => {
  it('adds the entry to the history slice', async () => {
    await mount()
    act(() => {
      emitTauriEvent('history:entry_added', {
        id: 'h1',
        title: 'T',
        url: 'u',
        downloadedAt: '2026-01-01T00:00:00Z',
        status: 'completed',
        version: '1.0',
      })
    })
    expect(store.getState().history.entries[0].id).toBe('h1')
  })
})

describe('download_cancelled', () => {
  it('marks cancelled, clears progress, and toasts', async () => {
    await mount()
    store.dispatch(enqueue({ downloadId: 'd1', status: 'running' }))
    act(() => {
      emitTauriEvent('progress', { ...progressBase, stage: 'audio' })
    })

    act(() => {
      emitTauriEvent('download_cancelled', { downloadId: 'd1' })
    })

    expect(queue().find((q) => q.downloadId === 'd1')!.status).toBe('cancelled')
    expect(
      selectProgressEntriesByDownloadId('d1')(store.getState()),
    ).toHaveLength(0)
    expect(toast.info).toHaveBeenCalledWith('video.download_cancelled')
  })

  it('keeps done items (late cancel race)', async () => {
    await mount()
    store.dispatch(enqueue({ downloadId: 'd1', status: 'done' }))

    act(() => {
      emitTauriEvent('download_cancelled', { downloadId: 'd1' })
    })

    expect(queue().find((q) => q.downloadId === 'd1')!.status).toBe('done')
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('keeps error items too', async () => {
    await mount()
    store.dispatch(enqueue({ downloadId: 'd1', status: 'error' }))

    act(() => {
      emitTauriEvent('download_cancelled', { downloadId: 'd1' })
    })

    expect(queue().find((q) => q.downloadId === 'd1')!.status).toBe('error')
  })
})

describe('quality/subtitle resolved events', () => {
  it('download-quality-resolved updates resolved quality and closes accordions', async () => {
    await mount()
    store.dispatch(
      initPartInputs([
        {
          cid: 1,
          page: 1,
          title: 'P1',
          videoQuality: '1080P',
          audioQuality: 'high',
          selected: true,
          duration: 60,
        },
      ]),
    )
    act(() => {
      emitTauriEvent('download-quality-resolved', {
        page: 1,
        videoQuality: 80,
        videoQualityFallback: false,
        videoCodecid: 7,
        videoCodecFallback: false,
        audioQuality: 30216,
        audioQualityFallback: false,
        isPreview: null,
      })
    })
    const part = store.getState().input.partInputs[0]
    expect(part.resolvedQuality?.videoQuality).toBe(80)
    expect(part.accordionOpen).toBe(false)
  })

  it('download-subtitle-resolved stores mode and labels', async () => {
    await mount()
    store.dispatch(
      initPartInputs([
        {
          cid: 1,
          page: 1,
          title: 'P1',
          videoQuality: '1080P',
          audioQuality: 'high',
          selected: true,
          duration: 60,
        },
        {
          cid: 2,
          page: 2,
          title: 'P2',
          videoQuality: '1080P',
          audioQuality: 'high',
          selected: true,
          duration: 60,
        },
      ]),
    )
    act(() => {
      emitTauriEvent('download-subtitle-resolved', {
        page: 2,
        subtitleMode: 'soft',
        subtitleLanguageLabels: ['日本語', 'English'],
      })
    })
    const sub = store.getState().input.partInputs[1]?.resolvedSubtitle
    expect(sub?.subtitleMode).toBe('soft')
    expect(sub?.subtitleLanguageLabels).toEqual(['日本語', 'English'])
  })
})

describe('download-subtitle-warning', () => {
  it('warns with the joined language list', async () => {
    await mount()
    act(() => {
      emitTauriEvent('download-subtitle-warning', {
        failedLanguages: ['日本語', 'Español'],
      })
    })
    expect(toast.warning).toHaveBeenCalledWith(
      'video.subtitle_download_failed',
      { duration: 6000 },
    )
  })
})

describe('download-retrying', () => {
  it('sets retrying on the matching progress entry', async () => {
    await mount()
    act(() => {
      emitTauriEvent('progress', { ...progressBase, stage: 'video' })
      emitTauriEvent('download-retrying', {
        downloadId: 'd1',
        stage: 'video',
        isRetrying: true,
      })
    })
    const entry = selectProgressEntriesByDownloadId('d1')(
      store.getState(),
    ).find((e) => e.stage === 'video')
    expect(entry?.isRetrying).toBe(true)
  })
})

describe('unmount', () => {
  it('detaches all listeners', async () => {
    const { unmount } = await mount()
    unmount()

    // Emit every wired event; none may touch state or toasts.
    act(() => {
      emitTauriEvent('progress', { ...progressBase, stage: 'complete' })
      emitTauriEvent('history:entry_added', {
        id: 'x',
        title: 't',
        url: 'u',
        downloadedAt: 'now',
        status: 'completed',
        version: '1.0',
      })
      emitTauriEvent('download_cancelled', { downloadId: 'd1' })
      emitTauriEvent('download-subtitle-warning', { failedLanguages: ['a'] })
    })

    expect(store.getState().history.entries).toHaveLength(0)
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
  })
})
