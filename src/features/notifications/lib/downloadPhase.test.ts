import { describe, expect, it } from 'vitest'

import type { QueueItem } from '@/shared/queue/queueSlice'

import { deriveDownloadPhase } from './downloadPhase'

function item(
  downloadId: string,
  status: QueueItem['status'],
  parentId?: string,
): QueueItem {
  return { downloadId, status, ...(parentId ? { parentId } : {}) }
}

describe('deriveDownloadPhase', () => {
  it('returns idle for empty queue', () => {
    expect(deriveDownloadPhase([])).toEqual({ phase: 'idle' })
  })

  it('returns idle when only orphan parents exist (no children)', () => {
    const queue: QueueItem[] = [item('parent-1', 'done')]
    expect(deriveDownloadPhase(queue)).toEqual({ phase: 'idle' })
  })

  it('returns active when any child is pending', () => {
    const queue: QueueItem[] = [
      item('parent-1', 'running'),
      item('parent-1-p1', 'done', 'parent-1'),
      item('parent-1-p2', 'pending', 'parent-1'),
    ]
    expect(deriveDownloadPhase(queue)).toEqual({ phase: 'active' })
  })

  it('returns active when any child is running', () => {
    const queue: QueueItem[] = [
      item('parent-1', 'running'),
      item('parent-1-p1', 'running', 'parent-1'),
    ]
    expect(deriveDownloadPhase(queue)).toEqual({ phase: 'active' })
  })

  it('returns active when a parent is cancelling even if all children are terminal', () => {
    const queue: QueueItem[] = [
      item('parent-1', 'cancelling'),
      item('parent-1-p1', 'cancelled', 'parent-1'),
      item('parent-1-p2', 'cancelled', 'parent-1'),
    ]
    expect(deriveDownloadPhase(queue)).toEqual({ phase: 'active' })
  })

  it('returns settled with hasSuccess=true when all children done', () => {
    const queue: QueueItem[] = [
      item('parent-1', 'done'),
      item('parent-1-p1', 'done', 'parent-1'),
      item('parent-1-p2', 'done', 'parent-1'),
    ]
    expect(deriveDownloadPhase(queue)).toEqual({
      phase: 'settled',
      hasSuccess: true,
      hasError: false,
    })
  })

  it('returns settled with hasError=true when any child errored', () => {
    const queue: QueueItem[] = [
      item('parent-1', 'error'),
      item('parent-1-p1', 'done', 'parent-1'),
      item('parent-1-p2', 'error', 'parent-1'),
    ]
    expect(deriveDownloadPhase(queue)).toEqual({
      phase: 'settled',
      hasSuccess: true,
      hasError: true,
    })
  })

  it('returns settled with neither flag when all cancelled (skip notification)', () => {
    const queue: QueueItem[] = [
      item('parent-1', 'cancelled'),
      item('parent-1-p1', 'cancelled', 'parent-1'),
      item('parent-1-p2', 'cancelled', 'parent-1'),
    ]
    expect(deriveDownloadPhase(queue)).toEqual({
      phase: 'settled',
      hasSuccess: false,
      hasError: false,
    })
  })

  it('returns settled with hasSuccess=true even if some siblings cancelled', () => {
    const queue: QueueItem[] = [
      item('parent-1', 'done'),
      item('parent-1-p1', 'done', 'parent-1'),
      item('parent-1-p2', 'cancelled', 'parent-1'),
    ]
    expect(deriveDownloadPhase(queue)).toEqual({
      phase: 'settled',
      hasSuccess: true,
      hasError: false,
    })
  })
})
