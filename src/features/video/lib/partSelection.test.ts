import { shouldSelectPart } from '@/features/video/lib/partSelection'
import type { VideoPart } from '@/features/video/types'
import { describe, expect, it } from 'vitest'

/** Minimal VideoPart factory for tests. */
const makePart = (overrides: Partial<VideoPart> = {}): VideoPart => ({
  part: 'Part',
  page: 1,
  cid: 100,
  duration: 60,
  videoQualities: [],
  audioQualities: [],
  thumbnail: { url: '' },
  subtitles: [],
  ...overrides,
})

describe('shouldSelectPart', () => {
  describe('bangumi with a requested epId', () => {
    const ctx = {
      contentType: 'bangumi' as const,
      videoEpId: 825757,
      pending: null,
    }

    it('selects only the part whose epId matches', () => {
      expect(shouldSelectPart(makePart({ epId: 825757 }), 0, ctx)).toBe(true)
      expect(shouldSelectPart(makePart({ epId: 999999 }), 1, ctx)).toBe(false)
    })

    it('does not fall back to first-page selection when epId is set', () => {
      // Even at index 0 (< PARTS_PER_PAGE), a non-matching epId is not selected
      expect(shouldSelectPart(makePart({ epId: 1 }), 0, ctx)).toBe(false)
    })
  })

  describe('video with a pending download', () => {
    it('selects by cid when pending.cid is provided', () => {
      const ctx = {
        contentType: 'video' as const,
        pending: { bvid: 'BV1xx', cid: 200, page: 1 },
      }
      expect(shouldSelectPart(makePart({ cid: 200 }), 5, ctx)).toBe(true)
      expect(shouldSelectPart(makePart({ cid: 999 }), 0, ctx)).toBe(false)
    })

    it('selects by page when pending.cid is null', () => {
      const ctx = {
        contentType: 'video' as const,
        pending: { bvid: 'BV1xx', cid: null, page: 3 },
      }
      expect(shouldSelectPart(makePart({ page: 3 }), 2, ctx)).toBe(true)
      expect(shouldSelectPart(makePart({ page: 1 }), 0, ctx)).toBe(false)
    })
  })

  describe('default (no specific target)', () => {
    const ctx = {
      contentType: 'video' as const,
      pending: null,
    }

    it('selects only the first page', () => {
      expect(shouldSelectPart(makePart(), 0, ctx)).toBe(true)
      expect(shouldSelectPart(makePart(), 9, ctx)).toBe(true)
    })

    it('does not select parts beyond the first page', () => {
      expect(shouldSelectPart(makePart(), 10, ctx)).toBe(false)
      expect(shouldSelectPart(makePart(), 83, ctx)).toBe(false)
    })

    it('falls back to first-page selection for bangumi without epId', () => {
      const bangumiCtx = {
        contentType: 'bangumi' as const,
        videoEpId: undefined,
        pending: null,
      }
      expect(shouldSelectPart(makePart(), 0, bangumiCtx)).toBe(true)
      expect(shouldSelectPart(makePart(), 10, bangumiCtx)).toBe(false)
    })
  })
})
