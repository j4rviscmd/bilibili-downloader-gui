/**
 * useRevealMainWindow suite. The main window is created hidden by the Rust
 * side (visible(false)); this hook is its only reveal path.
 */

import { mockInvoke } from '@/test/test-utils'
import { renderHook } from '@testing-library/react'
import { setTimeout as sleep } from 'node:timers/promises'
import { beforeEach, describe, expect, it } from 'vitest'
import { useRevealMainWindow } from './useRevealMainWindow'

// The bare vi.fn() from setup.ts returns undefined; the hook chains .catch.
beforeEach(() => {
  mockInvoke.mockResolvedValue(undefined)
})

describe('useRevealMainWindow', () => {
  it('invokes show_main exactly once on mount and not on rerender or unmount', () => {
    const { rerender, unmount } = renderHook(() => useRevealMainWindow())

    expect(mockInvoke).toHaveBeenCalledWith('show_main')
    rerender()
    unmount()
    // Why filter by command: the shared test-utils import chain fires an
    // unrelated `get_os` invoke at module load, so a raw call count would
    // count it too.
    expect(
      mockInvoke.mock.calls.filter((c) => c[0] === 'show_main'),
    ).toHaveLength(1)
  })

  it('swallows a rejected show_main instead of leaving it unhandled', async () => {
    // E.g. the command racing ahead of main-window creation; the hook must
    // not surface an unhandled rejection (mirrors useSplashLifecycle).
    mockInvoke.mockRejectedValueOnce(new Error('no main window'))
    renderHook(() => useRevealMainWindow())

    // Flush microtasks plus a macrotask tick: dropping the .catch in the
    // hook would surface as an unhandled rejection and fail this test.
    await sleep(10)
    expect(mockInvoke).toHaveBeenCalledWith('show_main')
  })
})
