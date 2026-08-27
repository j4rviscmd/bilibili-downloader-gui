/**
 * progressSlice unit suite — identity/upsert gaps.
 *
 * The sibling src/__tests__/unit/progressSlice.test.ts covers the
 * monotonic clamp, stage transitions, complete-replaces-merge, and
 * setRetrying. This file covers internalId computation, entry identity
 * (parentId forced to downloadId), in-place replacement, and the
 * by-download selector, against the real singleton store.
 */

import { store } from '@/app/store'
import { beforeEach, describe, expect, it } from 'vitest'

import type { Progress } from '@/shared/ui/Progress'
import {
  clearProgress,
  selectProgressEntriesByDownloadId,
  setProgress,
} from './progressSlice'

const baseProgress: Progress = {
  downloadId: 'dl-1',
  deltaTime: 0,
  filesize: 100,
  downloaded: 0,
  transferRate: 1024,
  percentage: 0,
  elapsedTime: 0,
  isComplete: false,
  stage: 'audio',
}

beforeEach(() => {
  store.dispatch(clearProgress())
})

describe('setProgress entry identity', () => {
  it('stores internalId as downloadId:stage and forces parentId to downloadId', () => {
    store.dispatch(setProgress(baseProgress))

    const [entry] = store.getState().progress
    expect(entry.internalId).toBe('dl-1:audio')
    // The slice overwrites whatever parentId the event carried so entries
    // group by their own download; the real parent linkage lives in queue.
    expect(entry.parentId).toBe('dl-1')
  })

  it('falls back to the bare downloadId when stage is undefined', () => {
    store.dispatch(setProgress({ ...baseProgress, stage: undefined }))

    const entries = store.getState().progress
    expect(entries).toHaveLength(1)
    expect(entries[0].internalId).toBe('dl-1')
  })

  it('keeps one entry per stage and replaces in place, preserving order', () => {
    store.dispatch(
      setProgress({ ...baseProgress, stage: 'audio', percentage: 10 }),
    )
    store.dispatch(
      setProgress({ ...baseProgress, stage: 'video', percentage: 20 }),
    )
    store.dispatch(
      setProgress({ ...baseProgress, stage: 'audio', percentage: 30 }),
    )

    const entries = store.getState().progress
    expect(entries.map((p) => p.internalId)).toEqual([
      'dl-1:audio',
      'dl-1:video',
    ])
    expect(entries[0].percentage).toBe(30)
  })

  it('gives complete its own entry when no merge entry exists', () => {
    store.dispatch(
      setProgress({ ...baseProgress, stage: 'audio', percentage: 100 }),
    )
    store.dispatch(
      setProgress({
        ...baseProgress,
        stage: 'complete',
        percentage: 100,
        isComplete: true,
      }),
    )

    const entries = store.getState().progress
    expect(entries.map((p) => p.internalId)).toEqual([
      'dl-1:audio',
      'dl-1:complete',
    ])
  })

  it('keeps downloads independent via distinct internalIds', () => {
    store.dispatch(
      setProgress({ ...baseProgress, stage: 'audio', percentage: 10 }),
    )
    store.dispatch(
      setProgress({
        ...baseProgress,
        downloadId: 'dl-2',
        stage: 'audio',
        percentage: 90,
      }),
    )

    const byId = Object.fromEntries(
      store.getState().progress.map((p) => [p.downloadId, p.percentage]),
    )
    expect(byId).toEqual({ 'dl-1': 10, 'dl-2': 90 })
  })

  it('clamps regression even when both filesizes are undefined', () => {
    // Stage-less events (no filesize field) still satisfy the
    // prev.filesize === payload.filesize guard via undefined === undefined,
    // so the monotonic clamp applies to them too.
    // Literal omits filesize/downloaded so both compare as undefined.
    const stageless = (percentage: number) =>
      ({
        downloadId: 'dl-1',
        deltaTime: 0,
        transferRate: 0,
        percentage,
        elapsedTime: 0,
        isComplete: false,
      }) as Progress
    store.dispatch(setProgress(stageless(50)))
    store.dispatch(setProgress(stageless(20)))

    expect(store.getState().progress[0].percentage).toBe(50)
  })
})

describe('selectProgressEntriesByDownloadId', () => {
  it('returns only the entries of the requested download', () => {
    store.dispatch(setProgress({ ...baseProgress, stage: 'audio' }))
    store.dispatch(setProgress({ ...baseProgress, stage: 'video' }))
    store.dispatch(
      setProgress({ ...baseProgress, downloadId: 'dl-2', stage: 'audio' }),
    )

    const entries = selectProgressEntriesByDownloadId('dl-1')(store.getState())

    expect(entries).toHaveLength(2)
    expect(entries.every((p) => p.downloadId === 'dl-1')).toBe(true)
    expect(
      selectProgressEntriesByDownloadId('missing')(store.getState()),
    ).toEqual([])
  })
})
