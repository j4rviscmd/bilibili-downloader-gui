import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/shared/lib/utils'

import { useSplashLifecycle } from '../hooks/useSplashLifecycle'
import { useThreeScene } from '../hooks/useThreeScene'
import { FADE_DURATION_MS } from '../lib/constants'

/**
 * Standalone splash window content (Discord-style).
 *
 * Renders inside the borderless, fixed-size, centered window created by the
 * Rust `create_splash_window`. The whole surface (including the Three.js
 * canvas) is draggable via `data-tauri-drag-region`. Shows the Three.js
 * animation + title, and at the bottom:
 * - a small "what's happening now" label (driven by `init_step` events)
 * - a determinate progress bar that appears only during ffmpeg download
 *   (driven by `progress` events whose downloadId === "ffmpeg-install")
 *
 * On fade completion `useSplashLifecycle` invokes `finish_splash`, which
 * closes this window and creates the main window.
 */
export function SplashScreen() {
  const { phase, onFadeComplete, skipMode } = useSplashLifecycle()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [stepLabel, setStepLabel] = useState<string>('')
  const [ffmpegProgress, setFfmpegProgress] = useState<number | null>(null)
  const { t } = useTranslation()

  useThreeScene(canvasRef, skipMode === false && phase !== 'done')

  // Show the splash window once React has mounted. The window is created
  // hidden (visible(false)) to avoid a black frame during webview load; this
  // reveals it after first paint.
  useEffect(() => {
    invoke('show_splash').catch(() => {})
  }, [])

  // init_step: latest backend step label. progress: ffmpeg download %.
  useEffect(() => {
    const unlistenStep = listen<{ labelKey: string }>('init_step', (event) => {
      setStepLabel(event.payload.labelKey)
    })
    const unlistenProgress = listen<{ downloadId: string; percentage: number }>(
      'progress',
      (event) => {
        if (event.payload.downloadId === 'ffmpeg-install') {
          setFfmpegProgress(event.payload.percentage)
        }
      },
    )
    return () => {
      unlistenStep.then((fn) => fn())
      unlistenProgress.then((fn) => fn())
    }
  }, [])

  if (phase === 'done') return null

  // Settings still loading: blank splash background to prevent a flash before
  // the 3D animation is ready to mount.
  if (skipMode === null) {
    return (
      <div
        data-testid="splash-screen"
        data-tauri-drag-region
        className="fixed inset-0 z-50 bg-[#f5f7fa]"
      />
    )
  }

  // Skip mode: minimal CSS spinner + step label instead of the full animation.
  if (skipMode === true) {
    return (
      <div
        data-testid="splash-screen"
        data-tauri-drag-region
        className="bg-background fixed inset-0 z-50 flex flex-col items-center justify-center"
      >
        <div className="border-foreground/20 border-t-foreground h-8 w-8 animate-spin rounded-full border-2" />
        {stepLabel && (
          <p className="text-muted-foreground mt-4 text-sm select-none">
            {t(stepLabel)}
          </p>
        )}
      </div>
    )
  }

  // Full animation mode: Three.js particle animation + title + bottom label
  // and, only while ffmpeg is installing, a determinate progress bar.
  const showFfmpegBar =
    stepLabel === 'init.installing_ffmpeg' && ffmpegProgress !== null

  return (
    <div
      data-testid="splash-screen"
      data-tauri-drag-region
      className={cn(
        'fixed inset-0 z-50 flex flex-col items-center justify-center',
        'bg-[#f5f7fa]',
        'transition-opacity ease-out',
        phase === 'fading' ? 'opacity-0' : 'opacity-100',
      )}
      style={{ transitionDuration: `${FADE_DURATION_MS}ms` }}
      onTransitionEnd={function handleTransitionEnd(e) {
        if (e.target === e.currentTarget && e.propertyName === 'opacity') {
          onFadeComplete()
        }
      }}
    >
      <canvas
        ref={canvasRef}
        data-tauri-drag-region
        className="absolute inset-0 h-full w-full"
      />
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
        <span style={{ color: '#00A1D6' }}>Bilibili</span> Downloader
      </h1>
      {showFfmpegBar && (
        <div className="absolute right-6 bottom-14 left-6 z-10 h-1 overflow-hidden rounded-full bg-black/10">
          <div
            className="h-full rounded-full bg-[#00A1D6] transition-all duration-300"
            style={{ width: `${ffmpegProgress}%` }}
          />
        </div>
      )}
      {stepLabel && (
        <p className="absolute right-6 bottom-6 left-6 z-10 truncate text-center text-[16px] font-medium text-[#6B7280] select-none">
          {t(stepLabel)}
        </p>
      )}
    </div>
  )
}
