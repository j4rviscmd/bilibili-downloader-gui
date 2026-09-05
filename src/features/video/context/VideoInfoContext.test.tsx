/**
 * VideoInfoContext suite.
 *
 * Renders the real provider with a probe component against mockInvoke-driven
 * RTK Query: URL validation branches (video / bangumi / ?p= / invalid /
 * error), part input initialization and updates, duplicate-title guarding,
 * and the download flow (enqueue, stale cleanup, per-part error handling).
 */

// The store must load before videoApi to break the circular import
// (store registers the api middleware, api imports the store).
import { store } from '@/app/store'
import { downloadVideo } from '@/features/video/api/downloadVideo'
import { videoApi } from '@/features/video/api/videoApi'
import {
  resetInput,
  setPendingDownload,
  updatePartSelected,
} from '@/features/video/model/inputSlice'
import { resetVideo } from '@/features/video/model/videoSlice'
import { clearError as clearDownloadError } from '@/shared/downloadStatus/downloadStatusSlice'
import { clearProgress } from '@/shared/progress/progressSlice'
import { clearQueue, enqueue } from '@/shared/queue'
import { toast } from '@/shared/ui/toast'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { act, waitFor } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Video } from '../types'
import {
  useVideoInfo,
  VideoInfoProvider,
  type VideoInfoContextValue,
} from './VideoInfoContext'

vi.mock('@/features/video/api/downloadVideo', () => ({
  downloadVideo: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

const downloadVideoMock = downloadVideo as unknown as Mock
const toastError = toast.error as unknown as Mock

const VIDEO_URL = 'https://www.bilibili.com/video/BV1xx411c7XD'
const BANGUMI_URL = 'https://www.bilibili.com/bangumi/play/ep3051843'

function partOf(overrides: Partial<Video['parts'][number]>) {
  return {
    part: 'Part 1',
    sanitizedPart: 'Part 1',
    defaultTitle: 'Test Video Part 1',
    page: 1,
    cid: 100,
    duration: 60,
    videoQualities: [{ quality: '1080p', id: 80 }],
    audioQualities: [{ quality: '64K', id: 30216 }],
    thumbnail: { url: 'thumb' },
    subtitles: [],
    ...overrides,
  }
}

const videoPayload: Video = {
  title: 'Test Video',
  bvid: 'BV1xx411c7XD',
  isLimitedQuality: false,
  contentType: 'video',
  parts: [
    partOf({ page: 1, cid: 100, part: 'Part 1', sanitizedPart: 'Part 1' }),
    partOf({
      page: 2,
      cid: 200,
      part: 'Part 2',
      sanitizedPart: 'Part 2',
      defaultTitle: 'Test Video Part 2',
    }),
  ],
}

const bangumiPayload: Video = {
  ...videoPayload,
  contentType: 'bangumi',
  epId: 3051843,
  parts: [
    partOf({
      page: 1,
      cid: 100,
      epId: 3051842,
      part: 'Episode 1',
      sanitizedPart: 'Episode 1',
      defaultTitle: 'Test Video Episode 1',
    }),
    partOf({
      page: 2,
      cid: 200,
      epId: 3051843,
      part: 'Episode 2',
      sanitizedPart: 'Episode 2',
      defaultTitle: 'Test Video Episode 2',
    }),
  ],
}

/** Latest context value captured by the probe. */
let ctx: VideoInfoContextValue

function Probe() {
  ctx = useVideoInfo()
  return null
}

function renderProvider() {
  return renderWithProviders(
    <VideoInfoProvider>
      <Probe />
    </VideoInfoProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // Clear the RTK Query cache: lazy triggers prefer cached data for the
  // same videoId, which would skip the invoke across tests.
  store.dispatch(videoApi.util.resetApiState())
  store.dispatch(resetInput())
  store.dispatch(resetVideo())
  store.dispatch(clearQueue())
  store.dispatch(clearProgress())
  store.dispatch(clearDownloadError())
  downloadVideoMock.mockResolvedValue(undefined)
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === 'fetch_video_info') return Promise.resolve(videoPayload)
    if (cmd === 'fetch_bangumi_info') return Promise.resolve(bangumiPayload)
    return Promise.resolve(undefined)
  })
})

describe('useVideoInfo guard', () => {
  it('throws when used outside the provider', () => {
    // Suppress the expected React error boundary noise for this assert.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderWithProviders(<Probe />)).toThrow(
      'useVideoInfo must be used within a VideoInfoProvider',
    )
    spy.mockRestore()
  })
})

describe('onValid1', () => {
  it('fetches a video URL and initializes part inputs with only page 1 selected', async () => {
    renderProvider()

    await act(async () => {
      await ctx.onValid1(VIDEO_URL)
    })

    expect(mockInvoke).toHaveBeenCalledWith('fetch_video_info', {
      videoId: 'BV1xx411c7XD',
    })
    expect(store.getState().video.title).toBe('Test Video')
    expect(store.getState().input.url).toBe(VIDEO_URL)

    const parts = store.getState().input.partInputs
    expect(parts).toHaveLength(2)
    // Titles embed the part name when it differs from the video title.
    expect(parts[0]?.title).toBe('Test Video Part 1')
    // Without a ?p= marker every part on the first page is selected
    // (PARTS_PER_PAGE = 10, this payload has 2 parts).
    expect(parts.map((p) => p.selected)).toEqual([true, true])
    expect(parts[0]?.subtitle).toEqual({ mode: 'off', selectedLans: [] })
    expect(ctx.isForm1Valid).toBe(true)
    expect(ctx.isFetching).toBe(false)
  })

  it('uses the backend default title without duplicating a matching part name', async () => {
    // Part name identical to the video title; the backend omits the
    // duplication from defaultTitle (omitDuplicatePartTitle setting).
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'fetch_video_info')
        return Promise.resolve({
          ...videoPayload,
          parts: [
            partOf({
              part: 'Test Video',
              sanitizedPart: 'Test Video',
              defaultTitle: 'Test Video',
            }),
          ],
        })
      return Promise.resolve(undefined)
    })

    renderProvider()

    await act(async () => {
      await ctx.onValid1(VIDEO_URL)
    })

    expect(store.getState().input.partInputs[0]?.title).toBe('Test Video')
  })

  it('selects only the ?p= part for a part URL', async () => {
    renderProvider()

    await act(async () => {
      await ctx.onValid1(`${VIDEO_URL}?p=2`)
    })

    expect(store.getState().input.partInputs.map((p) => p.selected)).toEqual([
      false,
      true,
    ])
    // The pending download is cleared after processing.
    expect(store.getState().input.pendingDownload).toBeNull()
  })

  it('routes a bangumi URL to fetch_bangumi_info and selects the epId episode', async () => {
    renderProvider()

    await act(async () => {
      await ctx.onValid1(BANGUMI_URL)
    })

    expect(mockInvoke).toHaveBeenCalledWith('fetch_bangumi_info', {
      epId: 3051843,
    })
    expect(store.getState().input.partInputs.map((p) => p.selected)).toEqual([
      false,
      true,
    ])
  })

  it('rejects an invalid URL with a toast and clears any pending download', async () => {
    store.dispatch(
      setPendingDownload({ bvid: 'BV1xx411c7XD', cid: null, page: 2 }),
    )
    renderProvider()

    await act(async () => {
      await ctx.onValid1('https://example.com/nope')
    })

    // The mount effect fetches the pending URL (valid); the invalid submit
    // adds its own toast and clears the pending download.
    expect(toastError).toHaveBeenCalledWith('video.fetch_info', {
      duration: 5000,
      description: 'validation.video.url.domain',
    })
    expect(store.getState().input.pendingDownload).toBeNull()
  })

  it('toasts the mapped backend error when the fetch fails', async () => {
    mockInvoke.mockRejectedValue(new Error('ERR::VIDEO_NOT_FOUND'))
    renderProvider()

    await act(async () => {
      await ctx.onValid1(VIDEO_URL)
    })

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError).toHaveBeenCalledWith('video.fetch_info', {
      duration: 5000,
      description: 'video.video_not_found',
    })
    expect(store.getState().video.title).toBe('')
  })

  it('skips the toast for an unauthorized session expiry', async () => {
    mockInvoke.mockRejectedValue(new Error('ERR::UNAUTHORIZED'))
    renderProvider()

    await act(async () => {
      await ctx.onValid1(VIDEO_URL)
    })

    expect(toastError).not.toHaveBeenCalled()
  })

  it('exposes isFetching while the lazy query is in flight', async () => {
    let resolveFetch: (v: Video) => void = () => {}
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd !== 'fetch_video_info') return Promise.resolve(undefined)
      return new Promise<Video>((resolve) => {
        resolveFetch = resolve
      })
    })
    renderProvider()

    let running: Promise<void> | undefined
    act(() => {
      running = ctx.onValid1(VIDEO_URL)
    })
    await act(async () => {})

    expect(ctx.isFetching).toBe(true)

    await act(async () => {
      resolveFetch(videoPayload)
      await running
    })
    expect(ctx.isFetching).toBe(false)
  })
})

describe('onValid2', () => {
  it('updates title and qualities for one part and keeps others untouched', async () => {
    renderProvider()
    await act(async () => {
      await ctx.onValid1(VIDEO_URL)
    })

    act(() => {
      ctx.onValid2(0, 'Custom name', '80', '30216')
    })

    const parts = store.getState().input.partInputs
    expect(parts[0]).toMatchObject({
      title: 'Custom name',
      videoQuality: '80',
      audioQuality: '30216',
    })
    // Untouched part keeps its initialized values.
    expect(parts[1]?.videoQuality).toBe('')
    expect(parts[1]?.audioQuality).toBe('')
  })

  it('omits the audioQuality field when it is not provided', async () => {
    renderProvider()
    await act(async () => {
      await ctx.onValid1(VIDEO_URL)
    })

    act(() => {
      ctx.onValid2(1, 'Second name', '64')
    })

    expect(store.getState().input.partInputs[1]).toMatchObject({
      title: 'Second name',
      videoQuality: '64',
      audioQuality: '',
    })
  })
})

describe('duplicate titles', () => {
  it('flags duplicates, blocks form 2 and toasts once', async () => {
    renderProvider()
    await act(async () => {
      await ctx.onValid1(VIDEO_URL)
    })
    // Give both selected parts the same normalized title. normalizeFilename
    // only strips forbidden characters and lowercases; whitespace stays.
    act(() => {
      ctx.onValid2(0, 'Same name', '80')
    })
    act(() => {
      ctx.onValid2(1, 'same NAME', '80')
    })

    await waitFor(() => {
      expect(ctx.duplicateIndices).toEqual([0, 1])
    })
    expect(ctx.isForm2ValidAll).toBe(false)
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('video.duplicate_titles', {
        duration: 5000,
      }),
    )
  })

  it('ignores duplicates on unselected parts', async () => {
    renderProvider()
    await act(async () => {
      await ctx.onValid1(VIDEO_URL)
    })
    // Both parts normalize to the same title, but the second is unselected.
    store.dispatch(updatePartSelected({ index: 1, selected: false }))
    act(() => {
      ctx.onValid2(0, 'Same name', '80')
      ctx.onValid2(1, 'same name', '80')
    })

    expect(ctx.duplicateIndices).toEqual([])
    expect(ctx.isForm2ValidAll).toBe(true)
    expect(ctx.selectedCount).toBe(1)
  })
})

describe('pending download effect', () => {
  it('fetches the pending video and selects its page', async () => {
    store.dispatch(
      setPendingDownload({ bvid: 'BV1xx411c7XD', cid: null, page: 2 }),
    )
    renderProvider()

    await waitFor(() => {
      expect(store.getState().input.partInputs).toHaveLength(2)
    })

    expect(mockInvoke).toHaveBeenCalledWith('fetch_video_info', {
      videoId: 'BV1xx411c7XD',
    })
    expect(store.getState().input.partInputs.map((p) => p.selected)).toEqual([
      false,
      true,
    ])
    expect(store.getState().input.pendingDownload).toBeNull()
  })
})

describe('download', () => {
  /** Full form state: valid URL + one selected, valid part. */
  async function setupForDownload() {
    renderProvider()
    await act(async () => {
      await ctx.onValid1(VIDEO_URL)
    })
    act(() => {
      ctx.onValid2(0, 'Custom name', '80', '30216')
    })
    store.dispatch(updatePartSelected({ index: 1, selected: false }))
  }

  it('enqueues parent and children, opens the dialog and awaits downloadVideo', async () => {
    await setupForDownload()

    await act(async () => {
      await ctx.download()
    })

    const queue = store.getState().queue
    const parent = queue.find((q) => !q.parentId)
    expect(parent).toMatchObject({
      filename: 'Test Video',
      status: 'pending',
    })
    expect(parent?.downloadId).toMatch(/^BV1xx411c7XD-[0-9a-f-]+$/)

    const children = queue.filter((q) => q.parentId === parent?.downloadId)
    expect(children).toHaveLength(1)
    expect(children[0]).toMatchObject({
      downloadId: `${parent?.downloadId}-p1`,
      filename: 'Custom name',
      status: 'pending',
    })

    expect(downloadVideoMock).toHaveBeenCalledTimes(1)
    expect(downloadVideoMock).toHaveBeenCalledWith(
      'BV1xx411c7XD',
      100,
      'Custom name',
      80,
      30216,
      `${parent?.downloadId}-p1`,
      parent?.downloadId,
      60,
      'thumb',
      1,
      { mode: 'off', selectedLans: [] },
      undefined,
      undefined,
    )
  })

  it('is a no-op while form 1 is invalid', async () => {
    await setupForDownload()
    // Flush the re-render so ctx.download rebinds to the invalid form state.
    act(() => {
      store.dispatch(resetInput())
    })

    await act(async () => {
      await ctx.download()
    })

    expect(downloadVideoMock).not.toHaveBeenCalled()
    expect(store.getState().queue).toHaveLength(0)
  })

  it('clears stale finished items for the same part numbers before starting', async () => {
    await setupForDownload()
    // A prior session's finished child for part 1 (different parent id).
    store.dispatch(
      enqueue({
        downloadId: 'old-parent-p1',
        parentId: 'old-parent',
        status: 'done',
      }),
    )

    await act(async () => {
      await ctx.download()
    })

    expect(
      store.getState().queue.find((q) => q.downloadId === 'old-parent-p1'),
    ).toBeUndefined()
  })

  it('skips a per-part cancel silently and continues to the next part', async () => {
    renderProvider()
    await act(async () => {
      await ctx.onValid1(VIDEO_URL)
    })
    act(() => {
      ctx.onValid2(0, 'First part', '80', '30216')
      ctx.onValid2(1, 'Second part', '80', '30216')
    })
    store.dispatch(updatePartSelected({ index: 1, selected: true }))

    downloadVideoMock.mockRejectedValueOnce(new Error('ERR::CANCELLED'))

    await act(async () => {
      await ctx.download()
    })

    // Both parts attempted; the cancelled part produced no toast.
    expect(downloadVideoMock).toHaveBeenCalledTimes(2)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('toasts with a retry hint for a transient network failure and continues', async () => {
    renderProvider()
    await act(async () => {
      await ctx.onValid1(VIDEO_URL)
    })
    act(() => {
      ctx.onValid2(0, 'First part', '80', '30216')
      ctx.onValid2(1, 'Second part', '80', '30216')
    })
    store.dispatch(updatePartSelected({ index: 1, selected: true }))

    downloadVideoMock.mockRejectedValueOnce(new Error('ERR::NETWORK::down'))

    await act(async () => {
      await ctx.download()
    })

    expect(downloadVideoMock).toHaveBeenCalledTimes(2)
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'video.download_failed',
        expect.objectContaining({ duration: Infinity }),
      ),
    )
    const call = toastError.mock.calls.find(
      ([t]) => t === 'video.download_failed',
    )
    expect(call?.[1].description).toContain('video.retry_hint')
  })

  it('toasts the mapped message for a non-transient failure', async () => {
    await setupForDownload()
    downloadVideoMock.mockRejectedValueOnce(new Error('ERR::DISK_FULL'))

    await act(async () => {
      await ctx.download()
    })

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'video.download_failed',
        expect.anything(),
      ),
    )
    const call = toastError.mock.calls.find(
      ([t]) => t === 'video.download_failed',
    )
    expect(call?.[1].description).not.toContain('video.retry_hint')
    // The raw mapped key rides inside the interpolated part description.
    expect(call?.[1].description).toContain(
      'video.download_failed_part_description',
    )
  })

  it('skips the toast when the failure is an unauthorized expiry', async () => {
    await setupForDownload()
    downloadVideoMock.mockRejectedValueOnce(new Error('ERR::UNAUTHORIZED'))

    await act(async () => {
      await ctx.download()
    })

    expect(toastError).not.toHaveBeenCalled()
  })
})
