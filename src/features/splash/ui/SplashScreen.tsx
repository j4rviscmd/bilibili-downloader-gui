import { useRef } from 'react'

import { useSelector } from '@/app/store'
import { cn } from '@/shared/lib/utils'

import { useSplashLifecycle } from '../hooks/useSplashLifecycle'
import { useThreeScene } from '../hooks/useThreeScene'
import { FADE_DURATION_MS } from '../lib/constants'

/**
 * Full-screen splash overlay displayed while the application initializes.
 *
 * In normal mode, renders a Three.js particle-and-TV animation, a title
 * heading, the current initialization step label, and an optional progress
 * bar. Once initialization completes (and the minimum display time elapses)
 * the component fades out and unmounts itself.
 *
 * When `skipSplashAnimation` is enabled, renders only a minimal CSS spinner
 * and the initialization step label for fastest possible startup.
 */
export function SplashScreen() {
  const { phase, onFadeComplete, skipMode } = useSplashLifecycle()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const processingFnc = useSelector((state) => state.init.processingFnc)
  const progress = useSelector((state) => state.progress)

  useThreeScene(canvasRef, skipMode === false && phase !== 'done')

  if (phase === 'done') return null

  // Show minimal spinner while loading settings or when skip mode is active
  if (skipMode === null || skipMode === true) {
    return (
      <div className="bg-background fixed inset-0 z-50 flex flex-col items-center justify-center">
        <div className="border-foreground/20 border-t-foreground h-8 w-8 animate-spin rounded-full border-2" />
        {processingFnc && (
          <p className="text-muted-foreground mt-4 text-sm select-none">
            {processingFnc}
          </p>
        )}
      </div>
    )
  }

  const activeProgress = progress.find((p) => !p.isComplete)
  const pct = activeProgress?.percentage ?? 0

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex flex-col items-center justify-center',
        'bg-[#f5f7fa]',
        'transition-opacity ease-out',
        phase === 'fading' ? 'opacity-0' : 'opacity-100',
      )}
      style={{ transitionDuration: `${FADE_DURATION_MS}ms` }}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && e.propertyName === 'opacity') {
          onFadeComplete()
        }
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <h1
        className={cn(
          'relative z-10 select-none',
          'font-sans text-4xl font-extralight tracking-[0.3em]',
          'fade-in animate-in duration-1000',
        )}
        style={{
          color: '#333333ee',
          textShadow: '0 0 40px rgba(0,161,214,0.2)',
        }}
      >
        <span style={{ color: '#00A1D6' }}>Bilibili</span>{' '}
        <span style={{ color: '#333333ee' }}>Downloader</span>
      </h1>
      {processingFnc && (
        <p className="relative z-10 mt-4 text-sm text-[#00A1D6]/60 select-none">
          {processingFnc}
        </p>
      )}
      {activeProgress && pct > 0 && (
        <div className="relative z-10 mt-3 h-1 w-48 overflow-hidden rounded-full bg-black/10">
          <div
            className="h-full rounded-full bg-[#00A1D6]/70 transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}
