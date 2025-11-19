import type { RootState } from '@/app/store'
import { createSelector } from '@reduxjs/toolkit'
import type { TFunction } from 'i18next'
import { buildVideoFormSchema1, buildVideoFormSchema2 } from './formSchema'
import { normalizeFilename } from './utils'

// Normalized titles (strip illegal chars same as validation rejects) & trim & lowercase for duplicate check
const selectPartInputs = (state: RootState) => state.input.partInputs

export const selectNormalizedTitles = createSelector(
  [selectPartInputs],
  (partInputs) => partInputs.map((pi) => normalizeFilename(pi.title)),
)

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

export const selectHasDuplicates = createSelector(
  [selectDuplicateIndices],
  (arr) => arr.length > 0,
)

export const selectIsForm1Valid = (tFn: TFunction) => (state: RootState) => {
  const schema1 = buildVideoFormSchema1(tFn)
  return schema1.safeParse({ url: state.input.url }).success
}

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

export const selectIsAllValid = (tFn: TFunction) =>
  createSelector(
    selectHasDuplicates,
    selectAllPartValid(tFn),
    (dup, all) => all && !dup,
  )

// Parent progress aggregation.
// Prefer weighted downloaded/filesize if available; fallback to average percentage; last fallback to stage weighting.
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
