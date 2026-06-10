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
 */
export function useThreeScene(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
): void {
  const sceneRef = useRef<SplashSceneHandle | null>(null)

  useEffect(() => {
    if (!enabled || !canvasRef.current) return

    let disposed = false

    import('../lib/createScene').then(({ createSplashScene }) => {
      if (disposed || !canvasRef.current) return
      sceneRef.current = createSplashScene(canvasRef.current)
    })

    return () => {
      disposed = true
      sceneRef.current?.dispose()
      sceneRef.current = null
    }
  }, [canvasRef, enabled])
}
