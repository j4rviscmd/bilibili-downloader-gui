import { describe, expect, it } from 'vitest'

import {
  clearProgress,
  clearProgressByDownloadId,
  progressSlice,
  setProgress,
  setRetrying,
} from '@/shared/progress/progressSlice'
import type { Progress } from '@/shared/ui/Progress'

/** Default progress fixture used as a baseline for all monotonic clamp tests. */
const baseProgress: Progress = {
  downloadId: 'test-dl-1',
  deltaTime: 0.5,
  filesize: 100,
  downloaded: 0,
  transferRate: 1024,
  percentage: 0,
  elapsedTime: 0,
  isComplete: false,
  stage: 'video',
}

describe('progressSlice', () => {
  describe('setProgress - monotonic increase guarantee', () => {
    it('should accept forward progress without clamping', () => {
      let state = progressSlice.reducer([], setProgress(baseProgress))
      state = progressSlice.reducer(
        state,
        setProgress({ ...baseProgress, percentage: 25, downloaded: 25 }),
      )
      state = progressSlice.reducer(
        state,
        setProgress({ ...baseProgress, percentage: 50, downloaded: 50 }),
      )

      expect(state[0].percentage).toBe(50)
      expect(state[0].downloaded).toBe(50)
    })

    it('should clamp backward percentage to previous maximum', () => {
      let state = progressSlice.reducer([], setProgress(baseProgress))
      state = progressSlice.reducer(
        state,
        setProgress({ ...baseProgress, percentage: 45, downloaded: 45 }),
      )
      // Simulate CDN switch rollback
      state = progressSlice.reducer(
        state,
        setProgress({ ...baseProgress, percentage: 30, downloaded: 30 }),
      )

      expect(state[0].percentage).toBe(45)
      expect(state[0].downloaded).toBe(45)
    })

    it('should clamp both percentage and downloaded independently', () => {
      let state = progressSlice.reducer(
        [],
        setProgress({ ...baseProgress, percentage: 50, downloaded: 50 }),
      )
      // percentage decreases but downloaded increases
      state = progressSlice.reducer(
        state,
        setProgress({ ...baseProgress, percentage: 30, downloaded: 55 }),
      )

      expect(state[0].percentage).toBe(50)
      expect(state[0].downloaded).toBe(55)
    })

    it('should bypass clamp when isComplete is true', () => {
      let state = progressSlice.reducer(
        [],
        setProgress({ ...baseProgress, percentage: 80, downloaded: 80 }),
      )
      state = progressSlice.reducer(
        state,
        setProgress({
          ...baseProgress,
          percentage: 100,
          downloaded: 100,
          isComplete: true,
        }),
      )

      expect(state[0].percentage).toBe(100)
      expect(state[0].downloaded).toBe(100)
      expect(state[0].isComplete).toBe(true)
    })

    it('should not clamp new entries (no existing internalId)', () => {
      const state = progressSlice.reducer(
        [],
        setProgress({ ...baseProgress, percentage: 10, downloaded: 10 }),
      )

      expect(state[0].percentage).toBe(10)
      expect(state[0].downloaded).toBe(10)
    })

    it('should reset clamp on stage transition', () => {
      let state = progressSlice.reducer(
        [],
        setProgress({
          ...baseProgress,
          stage: 'audio',
          percentage: 80,
          downloaded: 80,
        }),
      )
      // New stage creates a new entry with fresh clamping
      state = progressSlice.reducer(
        state,
        setProgress({
          ...baseProgress,
          stage: 'video',
          percentage: 5,
          downloaded: 5,
        }),
      )

      expect(state).toHaveLength(2)
      expect(state[0].percentage).toBe(80) // audio unchanged
      expect(state[1].percentage).toBe(5) // video starts fresh
    })

    it('should accept complete stage replacing merge entry', () => {
      let state = progressSlice.reducer(
        [],
        setProgress({
          ...baseProgress,
          stage: 'merge',
          percentage: 95,
          downloaded: 95,
        }),
      )
      state = progressSlice.reducer(
        state,
        setProgress({
          ...baseProgress,
          stage: 'complete',
          percentage: 100,
          downloaded: 100,
          isComplete: true,
        }),
      )

      expect(state).toHaveLength(1)
      expect(state[0].stage).toBe('complete')
      expect(state[0].percentage).toBe(100)
      expect(state[0].isComplete).toBe(true)
    })

    it('should handle multiple CDN switch rollbacks', () => {
      let state = progressSlice.reducer([], setProgress(baseProgress))

      // Progress to 30%
      state = progressSlice.reducer(
        state,
        setProgress({ ...baseProgress, percentage: 30, downloaded: 30 }),
      )
      // CDN switch rollback to 10%
      state = progressSlice.reducer(
        state,
        setProgress({ ...baseProgress, percentage: 10, downloaded: 10 }),
      )
      // CDN switch rollback to 5%
      state = progressSlice.reducer(
        state,
        setProgress({ ...baseProgress, percentage: 5, downloaded: 5 }),
      )
      // Recovery to 35%
      state = progressSlice.reducer(
        state,
        setProgress({ ...baseProgress, percentage: 35, downloaded: 35 }),
      )

      expect(state[0].percentage).toBe(35)
      expect(state[0].downloaded).toBe(35)
    })
  })

  describe('clearProgress', () => {
    it('should clear all progress entries', () => {
      let state = progressSlice.reducer(
        [],
        setProgress({ ...baseProgress, percentage: 50, downloaded: 50 }),
      )
      state = progressSlice.reducer(state, clearProgress())

      expect(state).toHaveLength(0)
    })
  })

  describe('clearProgressByDownloadId', () => {
    it('should clear entries for a specific download', () => {
      let state = progressSlice.reducer(
        [],
        setProgress({ ...baseProgress, downloadId: 'dl-1', percentage: 50 }),
      )
      state = progressSlice.reducer(
        state,
        setProgress({
          ...baseProgress,
          downloadId: 'dl-2',
          percentage: 30,
        }),
      )
      state = progressSlice.reducer(state, clearProgressByDownloadId('dl-1'))

      expect(state).toHaveLength(1)
      expect(state[0].downloadId).toBe('dl-2')
    })
  })

  describe('isRetrying propagation', () => {
    it('should preserve previous isRetrying when payload is undefined', () => {
      // Simulate retry_download flow: existing entry has isRetrying=true
      // (set via setRetrying), then a new Emits instance sends Progress
      // without isRetrying (Rust Option<bool> = None). The existing
      // isRetrying state must be preserved to avoid flicker.
      let state = progressSlice.reducer(
        [],
        setProgress({ ...baseProgress, percentage: 50 }),
      )
      state = progressSlice.reducer(
        state,
        setRetrying({
          downloadId: 'test-dl-1',
          stage: 'video',
          isRetrying: true,
        }),
      )
      expect(state[0].isRetrying).toBe(true)

      // New Emits instance emits Progress with isRetrying undefined (None)
      state = progressSlice.reducer(
        state,
        setProgress({ ...baseProgress, percentage: 55 }),
      )
      expect(state[0].isRetrying).toBe(true)
    })

    it('should update isRetrying when explicitly set via setProgress', () => {
      // CDN rotation path: Emits::set_retrying(true/false) sends Progress
      // with isRetrying explicitly set. This must overwrite the value.
      let state = progressSlice.reducer(
        [],
        setProgress({ ...baseProgress, percentage: 50 }),
      )
      expect(state[0].isRetrying).toBeUndefined()

      // CDN rotation detected → set_retrying(true)
      state = progressSlice.reducer(
        state,
        setProgress({ ...baseProgress, percentage: 50, isRetrying: true }),
      )
      expect(state[0].isRetrying).toBe(true)

      // First chunk from new CDN → set_retrying(false)
      state = progressSlice.reducer(
        state,
        setProgress({ ...baseProgress, percentage: 55, isRetrying: false }),
      )
      expect(state[0].isRetrying).toBe(false)
    })
  })

  describe('setRetrying', () => {
    it('should update isRetrying for matching downloadId', () => {
      let state = progressSlice.reducer(
        [],
        setProgress({ ...baseProgress, downloadId: 'dl-1' }),
      )
      state = progressSlice.reducer(
        state,
        setProgress({ ...baseProgress, downloadId: 'dl-2' }),
      )

      state = progressSlice.reducer(
        state,
        setRetrying({
          downloadId: 'dl-1',
          isRetrying: true,
        }),
      )

      expect(state[0].isRetrying).toBe(true)
      expect(state[1].isRetrying).toBeUndefined()
    })

    it('should update isRetrying only for matching stage', () => {
      let state = progressSlice.reducer(
        [],
        setProgress({
          ...baseProgress,
          stage: 'audio',
          percentage: 50,
        }),
      )
      state = progressSlice.reducer(
        state,
        setProgress({
          ...baseProgress,
          stage: 'video',
          percentage: 50,
        }),
      )

      state = progressSlice.reducer(
        state,
        setRetrying({
          downloadId: 'test-dl-1',
          stage: 'audio',
          isRetrying: true,
        }),
      )

      expect(state[0].isRetrying).toBe(true) // audio
      expect(state[1].isRetrying).toBeUndefined() // video
    })

    it('should update all stages when stage is undefined', () => {
      let state = progressSlice.reducer(
        [],
        setProgress({
          ...baseProgress,
          stage: 'audio',
          percentage: 50,
        }),
      )
      state = progressSlice.reducer(
        state,
        setProgress({
          ...baseProgress,
          stage: 'video',
          percentage: 50,
        }),
      )

      state = progressSlice.reducer(
        state,
        setRetrying({
          downloadId: 'test-dl-1',
          isRetrying: true,
        }),
      )

      expect(state[0].isRetrying).toBe(true) // audio
      expect(state[1].isRetrying).toBe(true) // video
    })

    it('should be a no-op when no entries match', () => {
      let state = progressSlice.reducer(
        [],
        setProgress({ ...baseProgress, downloadId: 'dl-1' }),
      )
      const stateBefore = state

      state = progressSlice.reducer(
        state,
        setRetrying({
          downloadId: 'dl-other',
          isRetrying: true,
        }),
      )

      expect(state).toBe(stateBefore)
    })

    it('should clear isRetrying when set to false', () => {
      let state = progressSlice.reducer(
        [],
        setProgress({ ...baseProgress, isRetrying: true }),
      )
      expect(state[0].isRetrying).toBe(true)

      state = progressSlice.reducer(
        state,
        setRetrying({
          downloadId: 'test-dl-1',
          isRetrying: false,
        }),
      )
      expect(state[0].isRetrying).toBe(false)
    })
  })
})
