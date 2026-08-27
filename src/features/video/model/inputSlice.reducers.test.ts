/**
 * inputSlice reducer suite — gaps not covered by inputSlice.test.ts.
 *
 * The sibling inputSlice.test.ts covers subtitle config, lazy-loaded
 * subtitles/qualities, resetInput and homePage. This file covers the
 * selection reducers, whole-state replacement, resolved-info reducers,
 * accordion state, and pendingDownload, against the real singleton
 * store (the established convention).
 */

import { store } from '@/app/store'
import { beforeEach, describe, expect, it } from 'vitest'

import type { PendingDownload } from '@/features/video/types'
import {
  clearPendingDownload,
  clearResolvedInfo,
  closeAllAccordions,
  deselectAll,
  deselectPageAll,
  initPartInputs,
  resetInput,
  selectAll,
  selectHasSelectedParts,
  selectPageAll,
  setAccordionOpen,
  setInput,
  setPartQualities,
  setPendingDownload,
  setResolvedQuality,
  setResolvedSubtitle,
  setUrl,
  updatePartInputByIndex,
  updatePartSelected,
} from './inputSlice'

function input() {
  return store.getState().input
}

/** Seeds three parts; index 1 starts deselected for selection tests. */
function seedParts() {
  store.dispatch(
    initPartInputs([
      {
        cid: 1,
        page: 1,
        title: 'Part 1',
        videoQuality: '80',
        audioQuality: '30216',
        selected: true,
        duration: 60,
      },
      {
        cid: 2,
        page: 2,
        title: 'Part 2',
        videoQuality: '80',
        audioQuality: '30216',
        selected: false,
        duration: 70,
      },
      {
        cid: 3,
        page: 3,
        title: 'Part 3',
        videoQuality: '80',
        audioQuality: '30216',
        selected: true,
        duration: 80,
      },
    ]),
  )
}

beforeEach(() => {
  store.dispatch(resetInput())
})

describe('whole-state replacement', () => {
  it('setInput replaces the entire input state', () => {
    const next = {
      url: 'https://www.bilibili.com/video/BV1xx411c7XD',
      partInputs: [],
      pendingDownload: { bvid: 'BV1', cid: 1, page: 1 } as PendingDownload,
      homePage: 4,
    }

    store.dispatch(setInput(next))
    expect(input()).toEqual(next)
  })

  it('setUrl only touches the url field', () => {
    seedParts()
    store.dispatch(setUrl('https://www.bilibili.com/video/BV1'))
    expect(input().url).toBe('https://www.bilibili.com/video/BV1')
    expect(input().partInputs).toHaveLength(3)
  })
})

describe('part field updates', () => {
  it('updatePartInputByIndex applies only the provided fields', () => {
    seedParts()
    store.dispatch(updatePartInputByIndex({ index: 0, title: 'Renamed' }))
    store.dispatch(updatePartInputByIndex({ index: 0, videoQuality: '116' }))

    expect(input().partInputs[0]).toMatchObject({
      title: 'Renamed',
      videoQuality: '116',
      audioQuality: '30216', // untouched
    })
  })

  it('updatePartInputByIndex ignores out-of-bounds indices', () => {
    seedParts()
    store.dispatch(updatePartInputByIndex({ index: 99, title: 'Ghost' }))
    expect(input().partInputs).toHaveLength(3)
    expect(input().partInputs.every((p) => p.title !== 'Ghost')).toBe(true)
  })

  it('setPartQualities applies the isPreview flag only when provided', () => {
    seedParts()
    store.dispatch(
      setPartQualities({
        index: 0,
        videoQualities: [{ quality: '1080p', id: 80 }],
        audioQualities: [{ quality: '64K', id: 30216 }],
      }),
    )
    expect(input().partInputs[0].isPreview).toBeUndefined()

    store.dispatch(
      setPartQualities({
        index: 0,
        videoQualities: [{ quality: '1080p', id: 80 }],
        audioQualities: [{ quality: '64K', id: 30216 }],
        isPreview: true,
      }),
    )
    expect(input().partInputs[0].isPreview).toBe(true)
  })
})

describe('selection reducers', () => {
  it('updatePartSelected toggles one part', () => {
    seedParts()
    store.dispatch(updatePartSelected({ index: 1, selected: true }))
    store.dispatch(updatePartSelected({ index: 0, selected: false }))

    expect(input().partInputs.map((p) => p.selected)).toEqual([
      false,
      true,
      true,
    ])
  })

  it('selectAll and deselectAll flip every part', () => {
    seedParts()
    store.dispatch(deselectAll())
    expect(input().partInputs.every((p) => !p.selected)).toBe(true)

    store.dispatch(selectAll())
    expect(input().partInputs.every((p) => p.selected)).toBe(true)
  })

  it('selectPageAll/deselectPageAll apply to the inclusive range only', () => {
    seedParts()
    store.dispatch(deselectAll())
    store.dispatch(selectPageAll({ startIndex: 1, endIndex: 2 }))
    expect(input().partInputs.map((p) => p.selected)).toEqual([
      false,
      true,
      true,
    ])

    store.dispatch(deselectPageAll({ startIndex: 1, endIndex: 2 }))
    expect(input().partInputs.map((p) => p.selected)).toEqual([
      false,
      false,
      false,
    ])
  })

  it('page range reducers skip out-of-bounds indices without throwing', () => {
    seedParts()
    const selectedBefore = input().partInputs.map((p) => p.selected)

    store.dispatch(selectPageAll({ startIndex: 5, endIndex: 9 }))
    store.dispatch(deselectPageAll({ startIndex: 99, endIndex: 200 }))

    expect(input().partInputs.map((p) => p.selected)).toEqual(selectedBefore)
    expect(input().partInputs).toHaveLength(3)
  })

  it('selectHasSelectedParts reflects the current selection', () => {
    expect(selectHasSelectedParts(store.getState())).toBe(false)

    seedParts()
    expect(selectHasSelectedParts(store.getState())).toBe(true)

    store.dispatch(deselectAll())
    expect(selectHasSelectedParts(store.getState())).toBe(false)
  })
})

describe('pendingDownload', () => {
  it('round-trips a pending download from watch history navigation', () => {
    const pending: PendingDownload = { bvid: 'BV1xx411c7XD', cid: 123, page: 2 }
    store.dispatch(setPendingDownload(pending))
    expect(input().pendingDownload).toEqual(pending)

    store.dispatch(clearPendingDownload())
    expect(input().pendingDownload).toBeNull()
  })
})

describe('accordion state', () => {
  it('persists per-part open state and closes all at once', () => {
    seedParts()
    store.dispatch(setAccordionOpen({ index: 0, open: true }))
    store.dispatch(setAccordionOpen({ index: 2, open: true }))

    expect(input().partInputs.map((p) => p.accordionOpen)).toEqual([
      true,
      undefined,
      true,
    ])

    store.dispatch(closeAllAccordions())
    expect(input().partInputs.every((p) => p.accordionOpen === false)).toBe(
      true,
    )
  })
})

describe('resolved info reducers', () => {
  it('setResolvedQuality maps page (1-based) to index and stores the rest', () => {
    seedParts()
    store.dispatch(
      setResolvedQuality({
        page: 2,
        videoQuality: 80,
        videoQualityFallback: true,
        videoCodecid: 7,
        videoCodecFallback: false,
        audioQuality: 30216,
        audioQualityFallback: false,
        isPreview: null,
      }),
    )

    expect(input().partInputs[1].resolvedQuality).toEqual({
      videoQuality: 80,
      videoQualityFallback: true,
      videoCodecid: 7,
      videoCodecFallback: false,
      audioQuality: 30216,
      audioQualityFallback: false,
      isPreview: null,
    })
    expect(input().partInputs[1].isPreview).toBeUndefined()
  })

  it('setResolvedQuality applies isPreview only when non-null', () => {
    seedParts()
    store.dispatch(
      setResolvedQuality({
        page: 1,
        videoQuality: 80,
        videoQualityFallback: false,
        videoCodecid: 7,
        videoCodecFallback: false,
        audioQuality: null,
        audioQualityFallback: false,
        isPreview: true,
      }),
    )
    expect(input().partInputs[0].isPreview).toBe(true)
  })

  it('setResolvedQuality ignores unknown pages', () => {
    seedParts()
    store.dispatch(
      setResolvedQuality({
        page: 99,
        videoQuality: 80,
        videoQualityFallback: false,
        videoCodecid: 7,
        videoCodecFallback: false,
        audioQuality: null,
        audioQualityFallback: false,
        isPreview: false,
      }),
    )
    expect(
      input().partInputs.every((p) => p.resolvedQuality === undefined),
    ).toBe(true)
  })

  it('setResolvedSubtitle stores mode and labels without the page', () => {
    seedParts()
    store.dispatch(
      setResolvedSubtitle({
        page: 3,
        subtitleMode: 'soft',
        subtitleLanguageLabels: ['zh-CN', 'en'],
      }),
    )

    expect(input().partInputs[2].resolvedSubtitle).toEqual({
      subtitleMode: 'soft',
      subtitleLanguageLabels: ['zh-CN', 'en'],
    })
  })

  it('clearResolvedInfo clears only the selected parts', () => {
    seedParts()
    // index 1 is deselected in the fixture — its info must survive
    const pages = [1, 2, 3]
    pages.forEach((page) => {
      store.dispatch(
        setResolvedSubtitle({
          page,
          subtitleMode: 'off',
          subtitleLanguageLabels: [],
        }),
      )
    })

    store.dispatch(clearResolvedInfo())

    expect(input().partInputs[0].resolvedSubtitle).toBeUndefined()
    expect(input().partInputs[2].resolvedSubtitle).toBeUndefined()
    expect(input().partInputs[1].resolvedSubtitle).toEqual({
      subtitleMode: 'off',
      subtitleLanguageLabels: [],
    })
  })
})
