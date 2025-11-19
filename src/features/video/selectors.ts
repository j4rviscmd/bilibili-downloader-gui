import type { RootState } from '@/app/store'
import { createSelector } from '@reduxjs/toolkit'
import { buildVideoFormSchema1, buildVideoFormSchema2 } from './formSchema'
import { normalizeFilename } from './utils'

// Normalize filename (strip illegal chars same as validation rejects) & trim & lowercase for duplicate check
export const selectNormalizedTitles = (state: RootState) =>
  state.input.partInputs.map((pi) => normalizeFilename(pi.title))

export const selectDuplicateIndices = createSelector(
  selectNormalizedTitles,
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
  selectDuplicateIndices,
  (arr) => arr.length > 0,
)

export const selectIsForm1Valid = (tFn: any) => (state: RootState) => {
  const schema1 = buildVideoFormSchema1(tFn)
  return schema1.safeParse({ url: state.input.url }).success
}

export const selectAllPartValid = (tFn: any) => (state: RootState) => {
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

export const selectIsAllValid = (tFn: any) =>
  createSelector(
    selectHasDuplicates,
    selectAllPartValid(tFn),
    (dup, all) => all && !dup,
  )

// Parent progress aggregation (percentage across child stages)
// Assumes progress entries each have total & loaded fields (if available) else falls back to stage weighting.
export const selectParentProgress =
  (parentId: string) => (state: RootState) => {
    const children = state.progress.filter((p: any) => p.parentId === parentId)
    if (children.length === 0) return 0
    let sumRatio = 0
    children.forEach((c: any) => {
      if (
        typeof c.loaded === 'number' &&
        typeof c.total === 'number' &&
        c.total > 0
      ) {
        sumRatio += c.loaded / c.total
      } else if (c.stage) {
        // simple stage weighting: audio/video/merge each ~1/3
        const stageWeight: Record<string, number> = {
          audio: 0.33,
          video: 0.33,
          merge: 0.34,
        }
        sumRatio += stageWeight[c.stage] || 0
      }
    })
    const ratio = sumRatio / children.length
    return Math.max(0, Math.min(1, ratio))
  }
