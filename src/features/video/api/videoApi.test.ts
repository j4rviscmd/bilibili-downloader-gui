import { describe, expect, it } from 'vitest'

// Load the store before videoApi: videoApi -> tauriBaseQuery -> store/index
// -> videoApi is a cycle that only resolves when store/index is entered
// first (tauriBaseQuery references `store` lazily at call time).
import '@/app/store'

import { fetchContentFromUrl } from './videoApi'

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
