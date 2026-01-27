import type { RootState } from '@/app/store'
import { createSelector } from '@reduxjs/toolkit'
import type { TFunction } from 'i18next'
import { buildVideoFormSchema1, buildVideoFormSchema2 } from '@/features/video/lib/formSchema'
import { normalizeFilename } from '@/features/video/lib/utils'

/**
 * Selects the part inputs from the Redux store.
 *
 * @param state - Root Redux state
 * @returns Array of part inputs
 */
const selectPartInputs = (state: RootState) => state.input.partInputs

/**
 * Memoized selector for normalized part titles.
 *
 * Normalizes each part title by removing forbidden characters, trimming,
 * and converting to lowercase for duplicate detection.
 */
export const selectNormalizedTitles = createSelector(
  [selectPartInputs],
  (partInputs) => partInputs.map((pi) => normalizeFilename(pi.title)),
)

/**
 * Memoized selector for indices of duplicate part titles.
 *
 * Returns an array of indices where the normalized title matches another
 * part's title. Empty if no duplicates exist.
 */
export const selectDuplicateIndices = createSelector(
  [selectNormalizedTitles],
  (titles) => {
    const map: Record<string, number[]> = {}
    titles.forEach((t, idx) => {
      if (!map[t]) map[t] = []
      map[t].push(idx)
    })
    return Object.values(map)
      .filter((arr) => arr.length > 1)
      .flat()
  },
)

/**
 * Memoized selector for whether duplicates exist.
 *
 * @returns True if any part titles are duplicated
 */
export const selectHasDuplicates = createSelector(
  [selectDuplicateIndices],
  (arr) => arr.length > 0,
)

/**
 * Selector factory for Form 1 (URL) validation status.
 *
 * @param tFn - Translation function for localized error messages
 * @returns A selector that checks if the URL is valid
 */
export const selectIsForm1Valid = (tFn: TFunction) => (state: RootState) => {
  const schema1 = buildVideoFormSchema1(tFn)
  return schema1.safeParse({ url: state.input.url }).success
}

/**
 * Selector factory for all parts validation status.
 *
 * @param tFn - Translation function for localized error messages
 * @returns A selector that checks if all part inputs are valid
 */
export const selectAllPartValid = (tFn: TFunction) => (state: RootState) => {
  const schema2 = buildVideoFormSchema2(tFn)
  return (
    state.input.partInputs.length > 0 &&
    state.input.partInputs.every(
      (pi) =>
        schema2.safeParse({
          title: pi.title,
          videoQuality: pi.videoQuality,
          audioQuality: pi.audioQuality,
        }).success,
    )
  )
}

/**
 * Selector factory for overall validation status.
 *
 * Combines part validation and duplicate checking.
 *
 * @param tFn - Translation function for localized error messages
 * @returns A memoized selector that checks if all validations pass
 */
export const selectIsAllValid = (tFn: TFunction) =>
  createSelector(
    selectHasDuplicates,
    selectAllPartValid(tFn),
    (dup, all) => all && !dup,
  )

/**
 * Selector factory for aggregated parent progress.
 *
 * Calculates overall progress for a multi-part download by aggregating
 * child progress entries. Uses weighted filesize if available, falls back
 * to average percentage, then stage-based weighting.
 *
 * @param parentId - The parent download ID
 * @returns A selector that returns the aggregated progress ratio (0-1)
 */
export const selectParentProgress =
  (parentId: string) => (state: RootState) => {
    const children = state.progress.filter((p) => p.parentId === parentId)
    if (children.length === 0) return 0

    let downloadedSum = 0
    let filesizeSum = 0
    let percentageSum = 0
    let percentageCount = 0
    let stageSum = 0
    let stageCount = 0

    const stageWeight: Record<string, number> = {
      audio: 0.33,
      video: 0.33,
      merge: 0.34,
    }

    children.forEach((c) => {
      if (typeof c.downloaded === 'number' && typeof c.filesize === 'number') {
        downloadedSum += c.downloaded
        filesizeSum += c.filesize
      } else if (typeof c.percentage === 'number' && !isNaN(c.percentage)) {
        percentageSum += c.percentage
        percentageCount += 1
      } else if (c.stage) {
        stageSum += stageWeight[c.stage] || 0
        stageCount += 1
      }
    })

    let ratio: number | null = null
    if (filesizeSum > 0) {
      ratio = downloadedSum / filesizeSum
    } else if (percentageCount > 0) {
      ratio = percentageSum / percentageCount / 100
    } else if (stageCount > 0) {
      ratio = stageSum / stageCount
    } else {
      ratio = 0
    }

    return Math.max(0, Math.min(1, ratio))
  }
