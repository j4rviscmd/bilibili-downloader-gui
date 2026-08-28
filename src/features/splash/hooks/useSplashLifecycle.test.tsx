/**
 * useSplashLifecycle suite (fake timers): normal fade path, skip mode,
 * finish_splash on done, disposed-before-fade guard.
 *
 * document.fonts.load is stubbed because happy-dom provides no FontFaceSet.
 */

import { mockInvoke, renderHookWithStore } from '@/test/test-utils'
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSplashLifecycle } from './useSplashLifecycle'

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mockInvoke.mockImplementation(() => Promise.resolve(undefined))
  vi.stubGlobal(
    'document',
    Object.assign(document, {
      fonts: { load: vi.fn().mockResolvedValue(undefined) },
    }),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function settingsPayload(skip: boolean) {
  mockInvoke.mockImplementation((cmd: string) =>
    Promise.resolve(
      cmd === 'get_settings' ? { skipSplashAnimation: skip } : undefined,
    ),
  )
}

async function flush(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useSplashLifecycle', () => {
  it('normal mode: active → fading after initialize + font + MIN_DISPLAY', async () => {
    settingsPayload(false)
    const { result } = renderHookWithStore(() => useSplashLifecycle())
    expect(result.current.phase).toBe('active')

    await flush(2_100)
    expect(mockInvoke).toHaveBeenCalledWith('get_settings')
    expect(mockInvoke).toHaveBeenCalledWith('initialize')
    expect(result.current.phase).toBe('fading')
    expect(result.current.skipMode).toBe(false)
  })

  it('skip mode: done immediately without the MIN_DISPLAY wait', async () => {
    settingsPayload(true)
    const { result } = renderHookWithStore(() => useSplashLifecycle())

    await flush(10)
    expect(result.current.phase).toBe('done')
    expect(result.current.skipMode).toBe(true)
  })

  it('done phase invokes finish_splash exactly once', async () => {
    settingsPayload(true)
    const { result } = renderHookWithStore(() => useSplashLifecycle())
    await flush(10)

    expect(mockInvoke).toHaveBeenCalledWith('finish_splash')
    const calls = mockInvoke.mock.calls.filter((c) => c[0] === 'finish_splash')
    expect(calls).toHaveLength(1)

    // Staying done must not re-fire
    await flush(50)
    expect(
      mockInvoke.mock.calls.filter((c) => c[0] === 'finish_splash'),
    ).toHaveLength(1)
    expect(result.current.phase).toBe('done')
  })

  it('onFadeComplete transitions fading → done', async () => {
    settingsPayload(false)
    const { result } = renderHookWithStore(() => useSplashLifecycle())
    await flush(2_100)
    expect(result.current.phase).toBe('fading')

    act(() => {
      result.current.onFadeComplete()
    })
    expect(result.current.phase).toBe('done')
  })

  it('get_settings rejection defaults to the normal splash', async () => {
    mockInvoke.mockRejectedValue(new Error('no store'))
    const { result } = renderHookWithStore(() => useSplashLifecycle())
    await flush(2_100)
    expect(result.current.skipMode).toBe(false)
    expect(result.current.phase).toBe('fading')
  })
})
