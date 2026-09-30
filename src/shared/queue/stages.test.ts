import { describe, expect, it } from 'vitest'

import type { Progress } from '@/shared/ui/Progress'

import { pickStageData } from './stages'

/** Builds a Progress stage entry (fields not under test defaulted). */
function entry(stage: string, percentage: number): Progress {
  return {
    downloadId: 'dl-1-p1',
    deltaTime: 1,
    filesize: 0,
    downloaded: 0,
    transferRate: 0,
    percentage,
    elapsedTime: 1,
    isComplete: false,
    stage,
  }
}

describe('pickStageData weighted percentage', () => {
  it('returns zeros for no entries', () => {
    const rep = pickStageData([])
    expect(rep.percentage).toBe(0)
    expect(rep.isComplete).toBe(false)
  })

  it('short-circuits to 100% on the complete stage', () => {
    const rep = pickStageData([entry('complete', 100)])
    expect(rep.percentage).toBe(100)
    expect(rep.isComplete).toBe(true)
  })

  it('weights audio and video at 45% each before merge starts', () => {
    const rep = pickStageData([entry('audio', 80), entry('video', 60)])
    // 0.45 * 80 + 0.45 * 60 — downloaded bytes own 90% of the bar.
    expect(rep.percentage).toBeCloseTo(0.45 * 80 + 0.45 * 60)
  })

  it('caps downloaded bytes at 90% and lets merge animate the last 10%', () => {
    const rep = pickStageData([
      entry('audio', 100),
      entry('video', 100),
      entry('merge', 50),
    ])
    expect(rep.percentage).toBeCloseTo(90 + 0.1 * 50)
    expect(rep.stage).toBe('merge')
  })

  it('gives video 90% for silent sources (no audio stage)', () => {
    const rep = pickStageData([entry('video', 50), entry('merge', 0)], {
      audioStage: false,
      mergeStage: true,
    })
    expect(rep.percentage).toBeCloseTo(0.9 * 50)
  })

  it('lets a durl download reach 100% with no merge share', () => {
    const rep = pickStageData([entry('video', 100)], {
      audioStage: false,
      mergeStage: false,
    })
    expect(rep.percentage).toBe(100)
  })
})

describe('pickStageData merge-fallback wiring', () => {
  it('prefers the ticking merge-fallback entry over the stale merge entry', () => {
    // Backend resets bytes to 0 when falling back to AAC re-encoding, so a
    // stale near-0% 'merge' entry coexists with the live fallback entry.
    const rep = pickStageData([
      entry('audio', 100),
      entry('video', 100),
      entry('merge', 0),
      entry('merge-fallback', 40),
    ])
    expect(rep.percentage).toBeCloseTo(90 + 0.1 * 40)
    expect(rep.merge?.percentage).toBe(40)
    // Falls under the merge stage flag → isMerging / cancel disabled.
    expect(rep.stage).toBe('merge')
  })

  it('uses the plain merge entry when no fallback ran', () => {
    const rep = pickStageData([
      entry('audio', 100),
      entry('video', 100),
      entry('merge', 30),
    ])
    expect(rep.merge?.percentage).toBe(30)
    expect(rep.percentage).toBeCloseTo(90 + 0.1 * 30)
  })
})
