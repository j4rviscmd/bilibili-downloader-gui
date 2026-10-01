/**
 * useThreeScene suite. The scene module is mocked (happy-dom has no WebGL
 * context): these tests verify the wiring — dark-flag propagation to
 * createSplashScene and scene recreation when the theme flips.
 */

import { renderHookWithStore } from '@/test/test-utils'
import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useThreeScene } from './useThreeScene'

// The real createSplashScene needs a WebGL context happy-dom cannot provide.
const { createSplashScene } = vi.hoisted(() => ({ createSplashScene: vi.fn() }))
vi.mock('../lib/createScene', () => ({ createSplashScene }))

function renderScene(dark?: boolean) {
  const canvas = document.createElement('canvas')
  const canvasRef = { current: canvas }
  renderHookWithStore(() => useThreeScene(canvasRef, true, dark))
  return canvas
}

describe('useThreeScene', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createSplashScene.mockImplementation(() => ({
      dispose: vi.fn(),
      resize: vi.fn(),
    }))
  })

  it('defaults the scene to the light palette', async () => {
    const canvas = renderScene()

    await waitFor(() => expect(createSplashScene).toHaveBeenCalledTimes(1))
    expect(createSplashScene).toHaveBeenCalledWith(canvas, false)
  })

  it('passes the dark flag to the scene', async () => {
    const canvas = renderScene(true)

    await waitFor(() => expect(createSplashScene).toHaveBeenCalledTimes(1))
    expect(createSplashScene).toHaveBeenCalledWith(canvas, true)
  })

  it('recreates the scene when the theme flips', async () => {
    const canvas = document.createElement('canvas')
    const canvasRef = { current: canvas }
    let dark = false
    const { rerender } = renderHookWithStore(() =>
      useThreeScene(canvasRef, true, dark),
    )

    await waitFor(() => expect(createSplashScene).toHaveBeenCalledTimes(1))
    const first = createSplashScene.mock.results[0].value

    dark = true
    rerender()

    // The light scene is disposed and a dark one takes its place.
    await waitFor(() => expect(createSplashScene).toHaveBeenCalledTimes(2))
    expect(first.dispose).toHaveBeenCalled()
    expect(createSplashScene).toHaveBeenLastCalledWith(canvas, true)
  })
})
