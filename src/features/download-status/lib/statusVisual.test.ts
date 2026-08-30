/**
 * statusVisual suite. Every known DownloadPartStatus maps to its label key,
 * dot class, and tone; the function is total over the union.
 */

import { describe, expect, it } from 'vitest'

import { getStatusVisual } from './statusVisual'

describe('getStatusVisual', () => {
  it('maps done to the completed tone', () => {
    expect(getStatusVisual('done')).toEqual({
      labelKey: 'downloadStatus.status_completed',
      dotClass: 'bg-green-500',
      tone: 'completed',
    })
  })

  it('maps running to the active tone', () => {
    expect(getStatusVisual('running')).toEqual({
      labelKey: 'downloadStatus.status_downloading',
      dotClass: 'bg-blue-500',
      tone: 'active',
    })
  })

  it('maps pending to the waiting tone', () => {
    expect(getStatusVisual('pending')).toEqual({
      labelKey: 'downloadStatus.status_waiting',
      dotClass: 'bg-muted-foreground',
      tone: 'waiting',
    })
  })

  it('maps cancelling and cancelled to the cancelled tone', () => {
    expect(getStatusVisual('cancelling').tone).toBe('cancelled')
    expect(getStatusVisual('cancelling').dotClass).toBe('bg-yellow-500')
    expect(getStatusVisual('cancelling').labelKey).toBe(
      'downloadStatus.status_cancelling',
    )

    expect(getStatusVisual('cancelled')).toEqual({
      labelKey: 'downloadStatus.status_cancelled',
      dotClass: 'bg-muted-foreground',
      tone: 'cancelled',
    })
  })

  it('maps error to the error tone', () => {
    expect(getStatusVisual('error')).toEqual({
      labelKey: 'downloadStatus.status_error',
      dotClass: 'bg-destructive',
      tone: 'error',
    })
  })

  it('treats an unknown status as pending', () => {
    // The MAP lookup falls back to pending for values outside the union
    // (defensive: statuses arrive from queue events).
    expect(getStatusVisual('nonsense' as never)).toEqual(
      getStatusVisual('pending'),
    )
  })
})
