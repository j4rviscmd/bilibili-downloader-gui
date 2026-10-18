/**
 * video feature selectors unit suite.
 *
 * Dispatches against the real singleton store (input / settings /
 * progress slices) and asserts selector output. `tFn` is the identity
 * translation function — schema messages never affect pass/fail.
 */

import { store } from '@/app/store'
import type { TFunction } from 'i18next'
import { beforeEach, describe, expect, it } from 'vitest'

import { clearProgress, setProgress } from '@/shared/progress/progressSlice'
import type { Progress } from '@/shared/ui/Progress'
import {
  initPartInputs,
  resetInput,
  setUrl,
  updatePartSelected,
} from './inputSlice'
import {
  selectAllPartValid,
  selectDuplicateIndices,
  selectIsForm1Valid,
  selectNormalizedTitles,
  selectParentProgress,
} from './selectors'

const t = ((key: string) => key) as TFunction

function seedTitles(titles: string[], selected = true) {
  store.dispatch(
    initPartInputs(
      titles.map((title, i) => ({
        cid: i + 1,
        page: i + 1,
        title,
        videoQuality: '80',
        audioQuality: '30216',
        selected,
        duration: 60,
      })),
    ),
  )
}

const baseProgress: Progress = {
  downloadId: 'parent',
  deltaTime: 0,
  filesize: 100,
  downloaded: 0,
  transferRate: 0,
  percentage: 0,
  elapsedTime: 0,
  isComplete: false,
  stage: 'audio',
}

beforeEach(() => {
  store.dispatch(resetInput())
  store.dispatch(clearProgress())
})

describe('selectNormalizedTitles', () => {
  it('trims, lowercases and strips forbidden filename characters', () => {
    seedTitles(['  My Video: Part 1 ', 'Test/File?'])
    expect(selectNormalizedTitles(store.getState())).toEqual([
      'my video part 1',
      'testfile',
    ])
  })
})

describe('selectDuplicateIndices', () => {
  it('flags every index of a duplicated group, flattened', () => {
    seedTitles(['Intro', 'Outro', 'intro', 'OUTRO'])
    expect(selectDuplicateIndices(store.getState()).sort()).toEqual([
      0, 1, 2, 3,
    ])
  })

  it('ignores unselected parts so their titles cannot block download', () => {
    seedTitles(['Intro', 'intro', 'solo'])
    store.dispatch(updatePartSelected({ index: 1, selected: false }))

    expect(selectDuplicateIndices(store.getState())).toEqual([])
  })

  it('returns nothing when all titles are unique', () => {
    seedTitles(['One', 'Two', 'Three'])
    expect(selectDuplicateIndices(store.getState())).toEqual([])
  })
})

describe('selectIsForm1Valid', () => {
  const urlRows: [string, boolean][] = [
    ['https://www.bilibili.com/video/BV1xx411c7XD', true],
    ['https://www.bilibili.com/bangumi/play/ep3051843', true],
    // b23.tv short links are expanded later in VideoForm1, so they pass here
    ['https://b23.tv/abc123', true],
    ['https://youtube.com/watch?v=x', false],
    ['https://live.bilibili.com/1234', false],
    ['not a url', false],
    ['', false],
  ]

  it.each(urlRows)('%j validates to %s', (url, expected) => {
    store.dispatch(setUrl(url))
    expect(selectIsForm1Valid(t)(store.getState())).toBe(expected)
  })
})

describe('selectAllPartValid', () => {
  it('passes when every selected part has a valid title', () => {
    seedTitles(['Part One', 'Part Two'])
    expect(selectAllPartValid(t)(store.getState())).toBe(true)
  })

  it('fails when nothing is selected', () => {
    seedTitles(['Part One'], false)
    expect(selectAllPartValid(t)(store.getState())).toBe(false)
  })

  it('skips unselected parts — an invalid title there does not block', () => {
    seedTitles(['Part One', 'x'])
    store.dispatch(updatePartSelected({ index: 1, selected: false }))
    expect(selectAllPartValid(t)(store.getState())).toBe(true)
  })

  const titleRows: [string, boolean][] = [
    ['x', false], // below the 2-char minimum
    ['ab/cd', false], // forbidden filename character (all platforms)
    ['Part One', true],
  ]

  it.each(titleRows)('title %j validates to %s', (title, expected) => {
    seedTitles([title])
    expect(selectAllPartValid(t)(store.getState())).toBe(expected)
  })
})

describe('selectParentProgress', () => {
  /** Entry without byte counts; omit percentage for the stage-weight fallback. */
  const bareEntry = (stage: string, percentage?: number) =>
    ({
      downloadId: 'parent',
      stage,
      percentage,
      deltaTime: 0,
      transferRate: 0,
      elapsedTime: 0,
      isComplete: false,
    }) as Progress

  it('weights by filesize when downloaded/filesize are numbers', () => {
    store.dispatch(
      setProgress({ ...baseProgress, stage: 'audio', downloaded: 30 }),
    )
    store.dispatch(
      setProgress({ ...baseProgress, stage: 'video', downloaded: 60 }),
    )

    // (30 + 60) / (100 + 100)
    expect(selectParentProgress('parent')(store.getState())).toBeCloseTo(0.45)
  })

  it('falls back to the average percentage without byte counts', () => {
    store.dispatch(setProgress(bareEntry('audio', 50)))
    store.dispatch(setProgress(bareEntry('video', 100)))

    // (50 + 100) / 2 / 100
    expect(selectParentProgress('parent')(store.getState())).toBeCloseTo(0.75)
  })

  it('falls back to stage weights without percentage or bytes', () => {
    // Stage-only entries: no numeric downloaded/filesize/percentage, so
    // the coarse audio/video weighting (0.33 each) kicks in.
    store.dispatch(setProgress(bareEntry('audio')))
    store.dispatch(setProgress(bareEntry('video')))

    // (0.33 + 0.33) / 2
    expect(selectParentProgress('parent')(store.getState())).toBeCloseTo(0.33)
  })

  it('clamps the ratio into 0..1 and ignores other downloads', () => {
    store.dispatch(
      setProgress({ ...baseProgress, stage: 'audio', downloaded: 200 }),
    )
    store.dispatch(
      setProgress({ ...baseProgress, downloadId: 'other', stage: 'audio' }),
    )

    expect(selectParentProgress('parent')(store.getState())).toBe(1)
    expect(selectParentProgress('other')(store.getState())).toBe(0)
  })
})
