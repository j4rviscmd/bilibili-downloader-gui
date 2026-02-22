/**
 * シンプルな並行実行数リミッター。
 *
 * 同時に実行できる非同期タスク数を制限し、
 * 超過分はキューに積んで順次実行する。
 *
 * @example
 * ```typescript
 * const limiter = createConcurrencyLimiter(3)
 * // 最大3並列で実行される
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
   * タスクをキューに追加し、並行制限内で実行する。
   *
   * @param fn - 実行する非同期関数
   * @returns タスクの戻り値の Promise
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
