import type { PayloadAction } from '@reduxjs/toolkit'
import { createSelector, createSlice } from '@reduxjs/toolkit'

import type { RootState } from '@/app/store'
import type { Progress } from '@/shared/ui/Progress'

/**
 * Computes an internal ID for a progress entry.
 *
 * The internal ID is used to uniquely identify progress entries within
 * a download. For the 'complete' stage, this function ensures that the
 * 'merge' entry is replaced with 'complete' to enable button unlocking.
 *
 * @param state - Current progress array
 * @param payload - Progress entry to compute ID for
 * @returns Internal ID string in format `{downloadId}:{stage}` or just `{downloadId}`
 */
function computeInternalId(state: Progress[], payload: Progress): string {
  if (payload.stage === 'complete') {
    const mergeId = `${payload.downloadId}:merge`
    const hasMerge = state.some((p) => p.internalId === mergeId)
    return hasMerge ? mergeId : `${payload.downloadId}:complete`
  }
  return payload.stage
    ? `${payload.downloadId}:${payload.stage}`
    : payload.downloadId
}

const initialState: Progress[] = []

/**
 * Redux slice for download progress tracking.
 *
 * Stores per-phase progress entries for each download. Each entry has an
 * internal ID computed from downloadId and stage (audio, video, merge).
 * The 'complete' stage replaces the 'merge' entry to enable button unlocking.
 */
export const progressSlice = createSlice({
  name: 'progress',
  initialState,
  reducers: {
    /**
     * Updates or adds a progress entry.
     *
     * Computes an internal ID based on downloadId and stage. If an entry
     * with the same internal ID exists, it is updated; otherwise, a new
     * entry is added. The 'complete' stage replaces the 'merge' entry if it exists.
     *
     * @param state - Current progress array
     * @param action - Action containing the progress data
     */
    setProgress(state, action: PayloadAction<Progress>) {
      const payload = action.payload
      const internalId = computeInternalId(state, payload)
      const idx = state.findIndex((p) => p.internalId === internalId)

      if (idx === -1) {
        state.push({
          ...payload,
          internalId,
          parentId: payload.downloadId,
        })
      } else {
        const prev = state[idx]
        // Monotonic clamp: prevent progress regression during CDN switches
        const percentage = payload.isComplete
          ? payload.percentage
          : Math.max(prev.percentage, payload.percentage)
        const downloaded = payload.isComplete
          ? payload.downloaded
          : Math.max(prev.downloaded, payload.downloaded)
        // isRetrying is preserved when undefined (Rust sends Option<bool>).
        // CDN rotation explicitly sets Some(true)/Some(false); retry_download
        // leaves it None so it doesn't clobber state set via setRetrying.
        const isRetrying = payload.isRetrying ?? prev.isRetrying
        state[idx] = {
          ...payload,
          internalId,
          parentId: payload.downloadId,
          percentage,
          downloaded,
          isRetrying,
        }
      }
    },
    /**
     * Updates the retrying flag for progress entries matching the given
     * download (and optionally stage).
     *
     * Driven by the `download-retrying` event emitted from `retry_download`
     * in the Rust backend. Unlike `setProgress`, this only updates
     * `isRetrying` and leaves all other fields untouched, avoiding the
     * side effect of resetting `filesize`/`downloaded` to null when
     * sending a partial Progress payload.
     *
     * @param state - Current progress array
     * @param action - Action containing downloadId, optional stage, and isRetrying
     */
    setRetrying(
      state,
      action: PayloadAction<{
        downloadId: string
        stage?: string
        isRetrying: boolean
      }>,
    ) {
      const { downloadId, stage, isRetrying } = action.payload
      for (const p of state) {
        if (p.downloadId !== downloadId) continue
        if (stage && p.stage !== stage) continue
        p.isRetrying = isRetrying
      }
    },
    /**
     * Clears all progress entries.
     */
    clearProgress() {
      return []
    },
    /**
     * Clears progress entries for a specific download.
     *
     * Used when a download is cancelled to remove its progress data.
     *
     * @param state - Current progress array
     * @param action - Action containing the download ID to clear
     */
    clearProgressByDownloadId(state, action: PayloadAction<string>) {
      const downloadId = action.payload
      return state.filter((p) => p.downloadId !== downloadId)
    },
  },
})

export const {
  setProgress,
  setRetrying,
  clearProgress,
  clearProgressByDownloadId,
} = progressSlice.actions
export default progressSlice.reducer

/**
 * Memoized selector factory for progress entries by download ID.
 *
 * @param downloadId - The download ID to filter by
 * @returns A memoized selector that returns progress entries for the download
 */
export const selectProgressEntriesByDownloadId = (downloadId: string) =>
  createSelector([(state: RootState) => state.progress], (progress) =>
    progress.filter((p) => p.downloadId === downloadId),
  )
