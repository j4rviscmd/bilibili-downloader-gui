/**
 * useSplashLifecycle suite (fake timers): language gate, fade path
 * (font-stall timeout), finish_splash on done.
 *
 * document.fonts.load is stubbed because happy-dom provides no FontFaceSet.
 */

import { mockInvoke, renderHookWithStore } from '@/test/test-utils'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSplashLifecycle } from './useSplashLifecycle'

// setup.ts returns a single shared window instance, so this is the same
// vi.fn the splash would invoke if it still locked its own theme.
const mockSetTheme = getCurrentWindow().setTheme as unknown as ReturnType<
  typeof vi.fn
>

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

async function flush(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useSplashLifecycle', () => {
  it('waits for first-run language selection before initializing', async () => {
    let enabled = false
    const { result, rerender } = renderHookWithStore(() =>
      useSplashLifecycle(enabled),
    )
    await flush(2_100)
    expect(mockInvoke).not.toHaveBeenCalledWith('initialize')
    expect(result.current.phase).toBe('active')
    enabled = true
    rerender()
    await flush(2_100)
    expect(mockInvoke).toHaveBeenCalledWith('initialize')
    expect(result.current.phase).toBe('fading')
  })

  it('transitions active → fading as soon as initialize and the font resolve', async () => {
    const { result } = renderHookWithStore(() => useSplashLifecycle())
    expect(result.current.phase).toBe('active')

    // No minimum display floor: the splash shows exactly as long as the real
    // work takes, and no settings round-trip gates the lifecycle.
    await flush(50)
    expect(mockInvoke).not.toHaveBeenCalledWith('get_settings')
    expect(mockInvoke).toHaveBeenCalledWith('initialize')
    expect(result.current.phase).toBe('fading')
  })

  it('fades as soon as a slow init completes, with no added display floor', async () => {
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === 'initialize'
        ? new Promise((resolve) => setTimeout(resolve, 3_000))
        : Promise.resolve(undefined),
    )
    const { result } = renderHookWithStore(() => useSplashLifecycle())

    // While init (3s) still runs the splash stays; fading starts at init
    // completion, not init + some floor.
    await flush(2_100)
    expect(result.current.phase).toBe('active')
    await flush(1_050)
    expect(result.current.phase).toBe('fading')
  })

  it('proceeds to fading when the font load stalls until its timeout', async () => {
    vi.stubGlobal(
      'document',
      Object.assign(document, {
        fonts: {
          load: vi.fn().mockImplementation(() => new Promise(() => {})),
        },
      }),
    )
    const { result } = renderHookWithStore(() => useSplashLifecycle())

    // With no minimum display floor, FONT_LOAD_TIMEOUT_MS (4s) is the only
    // remaining bound: a slow network cannot stall startup past its timeout.
    await flush(3_900)
    expect(result.current.phase).toBe('active')
    await flush(4_100)
    expect(result.current.phase).toBe('fading')
  })

  it('done phase invokes finish_splash exactly once', async () => {
    const { result } = renderHookWithStore(() => useSplashLifecycle())
    await flush(2_100)
    act(() => {
      result.current.onFadeComplete()
    })

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
    const { result } = renderHookWithStore(() => useSplashLifecycle())
    await flush(2_100)
    expect(result.current.phase).toBe('fading')

    act(() => {
      result.current.onFadeComplete()
    })
    expect(result.current.phase).toBe('done')
  })

  it('does not lock the native window theme (the Rust side sets it)', async () => {
    renderHookWithStore(() => useSplashLifecycle())
    await flush(2_100)

    // The splash must follow the theme chosen at window creation
    // (create_splash_window), not override it back to light.
    expect(mockSetTheme).not.toHaveBeenCalled()
  })
})
