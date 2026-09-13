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
import { videoApi } from '@/features/video/api/videoApi'
import {
  resetInput,
  setPendingDownload,
  setUrl,
  updatePartSelected,
} from '@/features/video/model/inputSlice'
import { resetVideo } from '@/features/video/model/videoSlice'
import { clearError as clearDownloadError } from '@/shared/downloadStatus/downloadStatusSlice'
import { clearProgress } from '@/shared/progress/progressSlice'
import { toast } from '@/shared/ui/toast'
import {
  mockInvoke,
  renderWithProviders,
  resetQueue,
  seedSession,
} from '@/test/test-utils'
import { act, waitFor } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Video } from '../types'
import {
  useVideoInfo,
  VideoInfoProvider,
  type VideoInfoContextValue,
} from './VideoInfoContext'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

const toastError = toast.error as unknown as Mock
const toastInfo = toast.info as unknown as Mock

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
  resetQueue()
  store.dispatch(clearProgress())
  store.dispatch(clearDownloadError())
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

    let running: Promise<boolean> | undefined
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

  it('applies video info and returns true on a silent success', async () => {
    renderProvider()

    let result: boolean | undefined
    await act(async () => {
      result = await ctx.onValid1(VIDEO_URL, { silent: true })
    })

    expect(result).toBe(true)
    expect(store.getState().input.partInputs).toHaveLength(2)
  })

  it('suppresses toasts and returns false on a silent failure', async () => {
    mockInvoke.mockRejectedValue(new Error('ERR::VIDEO_NOT_FOUND'))
    renderProvider()

    let result: boolean | undefined
    await act(async () => {
      result = await ctx.onValid1(VIDEO_URL, { silent: true })
    })

    expect(result).toBe(false)
    expect(toastError).not.toHaveBeenCalled()
    expect(store.getState().video.title).toBe('')
  })

  it('exposes isSilentFetching only while a silent fetch is in flight', async () => {
    let resolveFetch: (v: Video) => void = () => {}
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd !== 'fetch_video_info') return Promise.resolve(undefined)
      return new Promise<Video>((resolve) => {
        resolveFetch = resolve
      })
    })
    renderProvider()

    let running: Promise<boolean> | undefined
    act(() => {
      running = ctx.onValid1(VIDEO_URL, { silent: true })
    })
    await act(async () => {})

    expect(ctx.isFetching).toBe(true)
    expect(ctx.isSilentFetching).toBe(true)

    await act(async () => {
      resolveFetch(videoPayload)
      await running
    })
    expect(ctx.isSilentFetching).toBe(false)
  })

  it('discards a stale result when the URL moved on mid-flight', async () => {
    let resolveFetch: (v: Video) => void = () => {}
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd !== 'fetch_video_info') return Promise.resolve(undefined)
      return new Promise<Video>((resolve) => {
        resolveFetch = resolve
      })
    })
    renderProvider()

    let running: Promise<boolean> | undefined
    act(() => {
      running = ctx.onValid1(VIDEO_URL, { silent: true })
    })
    await act(async () => {})

    // Simulate a newer URL replacing the in-flight one while the input
    // stays enabled during the silent fetch.
    act(() => {
      store.dispatch(setUrl(`${VIDEO_URL}?p=2`))
    })

    await act(async () => {
      resolveFetch(videoPayload)
      const result = await running
      expect(result).toBe(false)
    })
    expect(store.getState().video.title).toBe('')
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

  it('enqueues one session with a snapshotted payload (issue #691)', async () => {
    await setupForDownload()

    await act(async () => {
      await ctx.download()
    })

    const queue = store.getState().queue
    const parent = queue.find((q) => q.kind === 'parent')
    expect(parent).toMatchObject({
      kind: 'parent',
      videoId: 'BV1xx411c7XD',
      title: 'Test Video',
      status: 'pending',
    })
    expect(parent?.downloadId).toMatch(/^BV1xx411c7XD-[0-9a-f-]+$/)

    const children = queue.filter((q) => q.parentId === parent?.downloadId)
    expect(children).toHaveLength(1)
    expect(children[0]).toMatchObject({
      downloadId: `${parent?.downloadId}-p1`,
      kind: 'part',
      cid: 100,
      partIndex: 1,
      title: 'Custom name',
      status: 'pending',
      videoId: 'BV1xx411c7XD',
    })
    // The backend invocation snapshot carries the selected settings.
    expect(children[0].payload).toMatchObject({
      videoId: 'BV1xx411c7XD',
      cid: 100,
      filename: 'Custom name',
      quality: 80,
      audioQuality: 30216,
      durationSeconds: 60,
      thumbnailUrl: 'thumb',
      page: 1,
      epId: null,
    })
    expect(children[0].expectedStages).toEqual({
      audioStage: true,
      mergeStage: true,
    })
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

    expect(store.getState().queue).toHaveLength(0)
  })

  it('keeps a prior finished session and appends the new one (latest wins)', async () => {
    await setupForDownload()
    // A prior session's finished child for the same videoId+cid.
    const oldParent = seedSession('BV1xx411c7XD', [
      { partIndex: 1, cid: 100, status: 'done' },
    ])

    await act(async () => {
      await ctx.download()
    })

    const queue = store.getState().queue
    // Old items survive (visible on /downloads until cleared)…
    expect(queue.find((q) => q.downloadId === `${oldParent}-p1`)).toBeDefined()
    // …and the new session lands as a second parent.
    const parents = queue.filter((q) => q.kind === 'parent')
    expect(parents).toHaveLength(2)
    expect(parents[parents.length - 1].status).toBe('pending')
  })

  it('excludes parts already active in the queue and toasts the count', async () => {
    await setupForDownload()
    // Same videoId+cid already pending in another session.
    seedSession('BV1xx411c7XD', [{ partIndex: 1, cid: 100, status: 'pending' }])

    await act(async () => {
      await ctx.download()
    })

    // Only ONE session for this video is pending-new: the fresh enqueue was
    // fully excluded (the single selected part is already active).
    const queue = store.getState().queue
    expect(queue.filter((q) => q.kind === 'parent')).toHaveLength(1)
    expect(queue.filter((q) => q.kind === 'part')).toHaveLength(1)
    expect(toastInfo).toHaveBeenCalledWith(
      'queue.duplicates_excluded',
      expect.objectContaining({ duration: 5000 }),
    )
  })
})
