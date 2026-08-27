import { describe, expect, it } from 'vitest'
import {
  clampPartDownloadConcurrency,
  createConcurrencyLimiter,
  MAX_PART_DOWNLOAD_CONCURRENCY,
  MIN_PART_DOWNLOAD_CONCURRENCY,
  resolvePartDownloadConcurrency,
} from './concurrency'

describe('clampPartDownloadConcurrency', () => {
  it('uses the CPU count when it is within the clamp range', () => {
    expect(clampPartDownloadConcurrency(8)).toBe(8)
    expect(clampPartDownloadConcurrency(4)).toBe(4)
  })

  it('floors fractional CPU counts', () => {
    expect(clampPartDownloadConcurrency(4.9)).toBe(4)
  })

  it('clamps a single-core machine up to the minimum', () => {
    expect(clampPartDownloadConcurrency(1)).toBe(MIN_PART_DOWNLOAD_CONCURRENCY)
  })

  it('caps high-core machines at the maximum', () => {
    expect(clampPartDownloadConcurrency(32)).toBe(MAX_PART_DOWNLOAD_CONCURRENCY)
    expect(clampPartDownloadConcurrency(128)).toBe(
      MAX_PART_DOWNLOAD_CONCURRENCY,
    )
  })

  it('falls back when the CPU count is invalid', () => {
    expect(clampPartDownloadConcurrency(0)).toBe(4)
    expect(clampPartDownloadConcurrency(-2)).toBe(4)
    expect(clampPartDownloadConcurrency(Number.NaN)).toBe(4)
  })
})

describe('resolvePartDownloadConcurrency', () => {
  it('returns a value inside the clamp range', () => {
    const n = resolvePartDownloadConcurrency()
    expect(n).toBeGreaterThanOrEqual(MIN_PART_DOWNLOAD_CONCURRENCY)
    expect(n).toBeLessThanOrEqual(MAX_PART_DOWNLOAD_CONCURRENCY)
  })

  it('caps concurrent parts so segment streams stay within the CDN budget', () => {
    // 8-core machine with default 8-way segment parallelism → 16/8 = 2 parts
    expect(resolvePartDownloadConcurrency(8, 8)).toBe(2)
    // Lower segment parallelism allows more parts
    expect(resolvePartDownloadConcurrency(8, 4)).toBe(4)
    expect(resolvePartDownloadConcurrency(8, 1)).toBe(8)
    // CPU clamp still wins when it is lower than the CDN budget
    expect(resolvePartDownloadConcurrency(2, 1)).toBe(2)
  })
})

describe('createConcurrencyLimiter', () => {
  it('never runs more than maxConcurrency tasks at once', async () => {
    const limiter = createConcurrencyLimiter(2)
    let running = 0
    let peak = 0

    const task = async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 20))
      running--
    }

    await Promise.all([
      limiter.run(task),
      limiter.run(task),
      limiter.run(task),
      limiter.run(task),
    ])

    expect(peak).toBe(2)
    expect(running).toBe(0)
  })
})
