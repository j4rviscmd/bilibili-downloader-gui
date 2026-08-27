/**
 * Minimum concurrent part downloads. Downloads are mostly I/O bound, so even
 * a single-core machine still benefits from a small amount of overlap.
 */
export const MIN_PART_DOWNLOAD_CONCURRENCY = 2

/**
 * Maximum concurrent part downloads. ffmpeg merge is CPU-heavy, and each
 * part also opens `downloadParallelism` HTTP streams; 16 parts × 8 segments
 * white-screens the UI and resets CDN connections.
 */
export const MAX_PART_DOWNLOAD_CONCURRENCY = 8

/**
 * Soft cap on simultaneous HTTP segment streams across all in-flight parts.
 * Bilibili CDNs reset bodies ("error decoding response body") well before
 * the OS connection limit when this is exceeded.
 */
export const MAX_TOTAL_SEGMENT_STREAMS = 16

/** Fallback when `navigator.hardwareConcurrency` is missing or invalid. */
const FALLBACK_CPU_COUNT = 4

/**
 * Clamps a logical CPU count into the allowed concurrent-download range.
 *
 * Invalid values (non-finite, ≤ 0) fall back to 4 before clamping, so
 * callers never have to special-case missing hardware info themselves.
 */
export function clampPartDownloadConcurrency(cpuCount: number): number {
  const resolved =
    Number.isFinite(cpuCount) && cpuCount > 0
      ? Math.floor(cpuCount)
      : FALLBACK_CPU_COUNT
  return Math.min(
    MAX_PART_DOWNLOAD_CONCURRENCY,
    Math.max(MIN_PART_DOWNLOAD_CONCURRENCY, resolved),
  )
}

/**
 * Resolves how many video parts may download at once from the machine's
 * logical CPU count, further limited so (parts × segment parallelism)
 * stays within {@link MAX_TOTAL_SEGMENT_STREAMS}.
 *
 * Uses core count (not live utilization) so the limit is stable across a
 * session instead of oscillating with load.
 *
 * @param hardwareConcurrency - Override for tests; defaults to `navigator.hardwareConcurrency`
 * @param downloadParallelism - Per-file segment concurrency from settings (1–8)
 */
export function resolvePartDownloadConcurrency(
  hardwareConcurrency?: number,
  downloadParallelism?: number,
): number {
  const cpuCount =
    typeof hardwareConcurrency === 'number'
      ? hardwareConcurrency
      : typeof navigator !== 'undefined'
        ? navigator.hardwareConcurrency
        : undefined
  const cpu = clampPartDownloadConcurrency(
    typeof cpuCount === 'number' ? cpuCount : FALLBACK_CPU_COUNT,
  )
  const segments =
    typeof downloadParallelism === 'number' &&
    Number.isFinite(downloadParallelism) &&
    downloadParallelism > 0
      ? Math.floor(downloadParallelism)
      : 8
  const byCdn = Math.max(
    MIN_PART_DOWNLOAD_CONCURRENCY,
    Math.floor(MAX_TOTAL_SEGMENT_STREAMS / segments),
  )
  return Math.min(cpu, byCdn)
}

/**
 * Simple concurrency limiter.
 *
 * Limits the number of asynchronous tasks that can run simultaneously,
 * queuing excess tasks for sequential execution.
 *
 * @example
 * ```typescript
 * const limiter = createConcurrencyLimiter(3)
 * // Runs with max 3 concurrent tasks
 * await limiter.run(() => fetch('/api/1'))
 * ```
 */
export function createConcurrencyLimiter(maxConcurrency: number) {
  let running = 0
  const queue: Array<() => void> = []

  function next() {
    if (queue.length === 0 || running >= maxConcurrency) return
    running++
    const resolve = queue.shift()!
    resolve()
  }

  /**
   * Queues a task and runs it within the concurrency limit.
   *
   * @param fn - Async function to execute
   * @returns Promise resolving to the task's return value
   */
  async function run<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      queue.push(resolve)
      next()
    })
    try {
      return await fn()
    } finally {
      running--
      next()
    }
  }

  return { run }
}
