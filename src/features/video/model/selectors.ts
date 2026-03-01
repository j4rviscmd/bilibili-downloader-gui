import type { RootState } from '@/app/store'
import {
  buildVideoFormSchema1,
  buildVideoFormSchema2,
} from '@/features/video/lib/formSchema'
import { normalizeFilename } from '@/features/video/lib/utils'
import { createSelector } from '@reduxjs/toolkit'
import type { TFunction } from 'i18next'

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
 *
 * @returns An array of normalized title strings for comparison.
 *
 * @example
 * ```typescript
 * const normalizedTitles = selectNormalizedTitles(state);
 * // Returns ['part one', 'part two', 'part one'] for duplicate detection
 * ```
 */
export const selectNormalizedTitles = createSelector(
  [selectPartInputs],
  (partInputs) => partInputs.map((pi) => normalizeFilename(pi.title)),
)

/**
 * Memoized selector for indices of duplicate part titles.
 *
 * Only considers selected (checked) parts for duplicate detection.
 * Unselected parts are excluded so their titles do not trigger
 * duplicate warnings or block the download button.
 *
 * @returns An array of indices where the normalized title matches
 *          another selected part's title. Empty if no duplicates exist.
 *
 * @example
 * ```typescript
 * const duplicateIndices = selectDuplicateIndices(state);
 * // Returns [0, 2, 3] if parts at indices 0, 2, and 3 have duplicate titles
 * ```
 */
export const selectDuplicateIndices = createSelector(
  [selectNormalizedTitles, selectPartInputs],
  (titles, partInputs) => {
    const map: Record<string, number[]> = {}
    titles.forEach((t, idx) => {
      if (!partInputs[idx]?.selected) return
      if (!map[t]) map[t] = []
      map[t].push(idx)
    })
    return Object.values(map)
      .filter((arr) => arr.length > 1)
      .flat()
  },
)

/**
 * Memoized selector for whether duplicates exist among selected parts.
 *
 * @returns `true` if any selected part titles are duplicated, `false` otherwise.
 *
 * @example
 * ```typescript
 * const hasDuplicates = selectHasDuplicates(state);
 * if (hasDuplicates) {
 *   // Show duplicate warning to user
 * }
 * ```
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
 * Only validates selected (checked) parts. Unselected parts are
 * skipped so their validation errors do not block downloads.
 *
 * @param tFn - Translation function for localized error messages
 * @returns A selector that checks if all selected part inputs are valid
 */
export const selectAllPartValid = (tFn: TFunction) => (state: RootState) => {
  const schema2 = buildVideoFormSchema2(tFn)
  const selectedParts = state.input.partInputs.filter((pi) => pi.selected)
  return (
    selectedParts.length > 0 &&
    selectedParts.every(
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
 * Combines part validation and duplicate checking. When autoRenameDuplicates
 * is enabled, duplicates are allowed since the backend will automatically
 * rename them with index suffixes (e.g., "Part (1)", "Part (2)").
 *
 * @param tFn - Translation function for localized error messages
 * @returns A memoized selector that returns `true` if all validations pass
 *
 * @example
 * ```typescript
 * const t = useTranslation().t;
 * const isAllValid = selectIsAllValid(t)(state);
 * // Returns true if all parts are valid and either no duplicates or auto-rename enabled
 * ```
 */
export const selectIsAllValid = (tFn: TFunction) =>
  createSelector(
    selectHasDuplicates,
    selectAllPartValid(tFn),
    (state: RootState) => state.settings.autoRenameDuplicates ?? true,
    (dup, all, autoRename) => all && (!dup || autoRename),
  )

/**
 * Selector factory for aggregated parent progress.
 *
 * Calculates overall progress for a multi-part download by aggregating
 * child progress entries. Uses weighted filesize if available, falls back
 * to average percentage, then stage-based weighting.
 *
 * Progress calculation priority:
 * 1. Filesize-based (downloaded/filesize) - most accurate
 * 2. Percentage-based (average of all percentages) - fallback
 * 3. Stage-based (audio 33%, video 33%, merge 34%) - coarse estimate
 *
 * @param parentId - The parent download ID to aggregate progress for
 * @returns A selector that returns the aggregated progress ratio (0-1)
 *
 * @example
 * ```typescript
 * const parentProgress = selectParentProgress('bv123456-1234567890')(state);
 * // Returns 0.5 for 50% complete, 0.0 for not started, 1.0 for complete
 * ```
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

    // Priority: filesize > percentage > stage > 0
    let ratio = 0
    if (filesizeSum > 0) {
      ratio = downloadedSum / filesizeSum
    } else if (percentageCount > 0) {
      ratio = percentageSum / percentageCount / 100
    } else if (stageCount > 0) {
      ratio = stageSum / stageCount
    }

    return Math.max(0, Math.min(1, ratio))
  }
