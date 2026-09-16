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
import {
  initPartInputs,
  resetInput,
  setUrl,
} from '@/features/video/model/inputSlice'
import {
  clearProgress,
  selectProgressEntriesByDownloadId,
} from '@/shared/progress/progressSlice'
import { enqueueSession } from '@/shared/queue'
import { toast } from '@/shared/ui/toast'
import { clearTauriEvents, emitTauriEvent } from '@/test/tauriEvents'
import { resetQueue, seedSession } from '@/test/test-utils'
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

/** Active part downloadId of the seeded session ('BVlistener-…-p1'). */
let d1 = 'd1'

/** Seeds one session part with the given status and points d1 at it. */
function useD1(status: 'pending' | 'running' | 'done' | 'error' = 'pending') {
  const parentId = seedSession('BVlistener', [{ partIndex: 1, cid: 1, status }])
  d1 = `${parentId}-p1`
  progressBase.downloadId = d1
  return d1
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
  resetQueue()
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
    useD1('pending')

    act(() => {
      emitTauriEvent('progress', { ...progressBase, stage: 'audio' })
    })

    expect(
      selectProgressEntriesByDownloadId(d1)(store.getState()),
    ).toHaveLength(1)
    expect(queue().find((q) => q.downloadId === d1)!.status).toBe('running')
  })

  it('marks done on complete stage', async () => {
    await mount()
    useD1('running')

    act(() => {
      emitTauriEvent('progress', { ...progressBase, stage: 'complete' })
    })

    expect(queue().find((q) => q.downloadId === d1)!.status).toBe('done')
  })

  it('unknown stage leaves queue status untouched', async () => {
    await mount()
    useD1('pending')

    act(() => {
      emitTauriEvent('progress', { ...progressBase, stage: 'finalize' })
    })

    expect(queue().find((q) => q.downloadId === d1)!.status).toBe('pending')
  })

  it('merge-fallback stage shows the audio-merge-fallback toast once', async () => {
    await mount()
    act(() => {
      emitTauriEvent('progress', { ...progressBase, stage: 'merge-fallback' })
    })
    expect(toast.info).toHaveBeenCalledTimes(1)
    expect(toast.info).toHaveBeenCalledWith('video.audio_merge_fallback', {
      duration: 6000,
    })
  })

  it('repeated merge-fallback progress events do not re-toast (issue #586)', async () => {
    await mount()
    // The backend ticker re-emits stage="merge-fallback" every 500ms during
    // the whole AAC re-encode; only the first event may toast.
    act(() => {
      emitTauriEvent('progress', { ...progressBase, stage: 'merge-fallback' })
      emitTauriEvent('progress', {
        ...progressBase,
        stage: 'merge-fallback',
        percentage: 20,
      })
    })
    expect(toast.info).toHaveBeenCalledTimes(1)
  })
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
    useD1('running')
    act(() => {
      emitTauriEvent('progress', { ...progressBase, stage: 'audio' })
    })

    act(() => {
      emitTauriEvent('download_cancelled', { downloadId: d1 })
    })

    expect(queue().find((q) => q.downloadId === d1)!.status).toBe('cancelled')
    expect(
      selectProgressEntriesByDownloadId(d1)(store.getState()),
    ).toHaveLength(0)
    expect(toast.info).toHaveBeenCalledWith('video.download_cancelled')
  })

  it('keeps done items (late cancel race)', async () => {
    await mount()
    useD1('done')

    act(() => {
      emitTauriEvent('download_cancelled', { downloadId: d1 })
    })

    expect(queue().find((q) => q.downloadId === d1)!.status).toBe('done')
    expect(toast.info).not.toHaveBeenCalled()
  })

  it('keeps error items too', async () => {
    await mount()
    useD1('error')

    act(() => {
      emitTauriEvent('download_cancelled', { downloadId: d1 })
    })

    expect(queue().find((q) => q.downloadId === d1)!.status).toBe('error')
  })
})

describe('quality/subtitle resolved events', () => {
  // The displayed video's URL decides which events may write state.input
  // (issue #691 pollution guard) — every test in this block must set it.
  function displayVideo(videoId: string) {
    store.dispatch(setUrl(`https://www.bilibili.com/video/${videoId}`))
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
  }

  it('download-quality-resolved updates resolved quality and closes accordions', async () => {
    await mount()
    displayVideo('BVlistener')
    act(() => {
      emitTauriEvent('download-quality-resolved', {
        downloadId: 'BVlistener-s1-p1',
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

  it('records resolved quality onto the queue item (background-safe)', async () => {
    await mount()
    displayVideo('BVlistener')
    // A queue item for a BACKGROUND download id.
    store.dispatch(
      enqueueSession({
        videoId: 'BVbackground',
        videoTitle: 'bg',
        parts: [
          {
            partIndex: 1,
            cid: 1,
            title: 'P1',
            thumbnailUrl: null,
            expectedStages: { audioStage: true, mergeStage: true },
            payload: {
              videoId: 'BVbackground',
              cid: 1,
              filename: 'P1',
              quality: null,
              audioQuality: null,
              durationSeconds: 60,
              thumbnailUrl: null,
              page: 1,
              epId: null,
              subtitle: null,
            },
          },
        ],
      }),
    )
    const itemId = store
      .getState()
      .queue.find((q) => q.kind === 'part')!.downloadId

    act(() => {
      emitTauriEvent('download-quality-resolved', {
        downloadId: itemId,
        page: 1,
        videoQuality: 80,
        videoQualityFallback: false,
        videoCodecid: 7,
        videoCodecFallback: false,
        audioQuality: 30280,
        audioQualityFallback: false,
        isPreview: null,
      })
    })

    const item = store.getState().queue.find((q) => q.downloadId === itemId)!
    expect(item.resolvedVideoQuality).toBe(80)
    expect(item.resolvedAudioQuality).toBe(30280)
    // And the DISPLAYED video's inputs stay untouched (guard intact).
    expect(store.getState().input.partInputs[0].resolvedQuality).toBeUndefined()
  })

  it('a background video resolved event does not pollute the displayed video', async () => {
    await mount()
    displayVideo('BVdisplayed')
    act(() => {
      emitTauriEvent('download-quality-resolved', {
        downloadId: 'BVbackground-s1-p1',
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
    expect(store.getState().input.partInputs[0].resolvedQuality).toBeUndefined()
  })

  it('download-subtitle-resolved stores mode and labels', async () => {
    await mount()
    displayVideo('BVlistener')
    act(() => {
      emitTauriEvent('download-subtitle-resolved', {
        downloadId: 'BVlistener-s1-p2',
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
        downloadId: d1,
        stage: 'video',
        isRetrying: true,
      })
    })
    const entry = selectProgressEntriesByDownloadId(d1)(store.getState()).find(
      (e) => e.stage === 'video',
    )
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
      emitTauriEvent('download_cancelled', { downloadId: d1 })
      emitTauriEvent('download-subtitle-warning', { failedLanguages: ['a'] })
    })

    expect(store.getState().history.entries).toHaveLength(0)
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
  })
})
