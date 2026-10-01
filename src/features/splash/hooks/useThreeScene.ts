import { type RefObject, useEffect, useRef } from 'react'
import type { SplashSceneHandle } from '../lib/createScene'

/**
 * Lazily initializes and renders the Three.js splash scene on the given canvas.
 *
 * The scene module is loaded dynamically so it does not block the initial
 * bundle. When `enabled` becomes `false` the scene is disposed and all GPU
 * resources are released.
 *
 * @param canvasRef - Ref to the `<canvas>` element to render into.
 * @param enabled   - Whether the scene should be active. Pass `false` to
 *   tear down the render loop and free resources.
 * @param dark      - Whether to render with the dark-theme palette.
 */
export function useThreeScene(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
  dark = false,
): void {
  const sceneRef = useRef<SplashSceneHandle | null>(null)

  useEffect(() => {
    if (!enabled || !canvasRef.current) return

    let disposed = false

    import('../lib/createScene').then(({ createSplashScene }) => {
      if (disposed || !canvasRef.current) return
      sceneRef.current = createSplashScene(canvasRef.current, dark)
    })

    return () => {
      disposed = true
      sceneRef.current?.dispose()
      sceneRef.current = null
    }
    // Note: a `dark` flip tears down and rebuilds the whole scene because
    // createSplashScene bakes the palette into the geometry's vertex colors at
    // creation; SplashSceneHandle exposes no live palette-swap API. The theme
    // param is fixed per splash window, so this only runs once in practice.
  }, [canvasRef, enabled, dark])
}
