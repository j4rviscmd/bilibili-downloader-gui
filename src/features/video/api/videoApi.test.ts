// Load the store before videoApi: videoApi -> tauriBaseQuery -> store/index
// -> videoApi is a cycle that only resolves when store/index is entered
// first (tauriBaseQuery references `store` lazily at call time).
import { store } from '@/app/store'
import { mockInvoke } from '@/test/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { fetchContentFromUrl, videoApi } from './videoApi'

describe('fetchContentInfo query builder', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue({})
  })

  it('routes a video id to fetch_video_info', async () => {
    await store.dispatch(
      videoApi.endpoints.fetchContentInfo.initiate({
        type: 'video',
        id: 'BV1xx411c7XD',
      }),
    )

    expect(mockInvoke).toHaveBeenCalledWith('fetch_video_info', {
      videoId: 'BV1xx411c7XD',
    })
  })

  it('routes a bangumi id to fetch_bangumi_info with a numeric epId', async () => {
    await store.dispatch(
      videoApi.endpoints.fetchContentInfo.initiate({
        type: 'bangumi',
        epId: '3051843',
      }),
    )

    expect(mockInvoke).toHaveBeenCalledWith('fetch_bangumi_info', {
      epId: 3051843,
    })
  })

  it('rejects a missing content id before any invoke', async () => {
    const result = await store.dispatch(
      videoApi.endpoints.fetchContentInfo.initiate(null as never),
    )

    expect(result.status).toBe('rejected')
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})

describe('fetchContentFromUrl', () => {
  it('maps a video URL to video args', () => {
    expect(
      fetchContentFromUrl('https://www.bilibili.com/video/BV1xx411c7XD'),
    ).toEqual({ type: 'video', id: 'BV1xx411c7XD' })
  })

  it('maps a bangumi URL to bangumi args with numeric epId', () => {
    expect(
      fetchContentFromUrl('https://www.bilibili.com/bangumi/play/ep3051843'),
    ).toEqual({ type: 'bangumi', epId: 3051843 })
  })

  it('keeps the page query out of the extracted video id', () => {
    expect(
      fetchContentFromUrl('https://www.bilibili.com/video/BV1xx411c7XD?p=2'),
    ).toEqual({ type: 'video', id: 'BV1xx411c7XD' })
  })

  it('returns null for a URL without video/bangumi path segments', () => {
    expect(fetchContentFromUrl('https://example.com/watch/12345')).toBe(null)
  })

  it('returns null for a bilibili URL without a recognized content path', () => {
    expect(fetchContentFromUrl('https://www.bilibili.com/space/12345')).toBe(
      null,
    )
  })

  it('returns null for an invalid URL string', () => {
    expect(fetchContentFromUrl('not-a-url')).toBe(null)
  })
})
