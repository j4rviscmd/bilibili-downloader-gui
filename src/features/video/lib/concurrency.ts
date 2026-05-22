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
