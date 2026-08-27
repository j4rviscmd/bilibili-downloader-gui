import { describe, expect, it } from 'vitest'

import { createConcurrencyLimiter } from './concurrency'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createConcurrencyLimiter', () => {
  it('never exceeds the configured concurrency', async () => {
    const limiter = createConcurrencyLimiter(2)
    let active = 0
    let peak = 0

    const tasks = Array.from({ length: 6 }, (_, i) =>
      limiter.run(async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 1))
        expect(active).toBeLessThanOrEqual(2)
        active--
        return i
      }),
    )

    const results = await Promise.all(tasks)
    expect(peak).toBe(2)
    expect(results).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('runs tasks sequentially with a limit of 1', async () => {
    const limiter = createConcurrencyLimiter(1)
    const order: number[] = []

    await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        limiter.run(async () => {
          order.push(i)
        }),
      ),
    )

    expect(order).toEqual([0, 1, 2])
  })

  it('releases the slot when a task rejects', async () => {
    const limiter = createConcurrencyLimiter(1)

    const first = limiter.run(async () => {
      throw new Error('boom')
    })
    // Second task can only start once the first releases its slot.
    const second = limiter.run(async () => 'ok')

    await expect(first).rejects.toThrow('boom')
    await expect(second).resolves.toBe('ok')
  })

  it('starts queued tasks as slots free up', async () => {
    const limiter = createConcurrencyLimiter(1)
    const gate = deferred<void>()

    const first = limiter.run(() => gate.promise)
    let secondStarted = false
    const second = limiter.run(async () => {
      secondStarted = true
    })

    await Promise.resolve()
    expect(secondStarted).toBe(false)

    gate.resolve()
    await first
    await second
    expect(secondStarted).toBe(true)
  })
})
