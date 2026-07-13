/**
 * Rotation feature hook.
 *
 * Encapsulates all state and orchestration for the rotation page: file dialogs,
 * form fields, and invocation of `rotate_video`. Components consume the returned
 * plain props — no Redux involvement needed because rotation is a one-shot,
 * stateless operation.
 */

import { store, useSelector } from '@/app/store'
import { callSetSettings } from '@/features/settings/api/settingApi'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open, save } from '@tauri-apps/plugin-dialog'
import { error as logError } from '@tauri-apps/plugin-log'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { rotateVideo } from '../api/rotationApi'
import type { RotationAngle, RotationMode, RotationProgress } from '../types'

export type RotationStatus = 'idle' | 'rotating' | 'success' | 'error'

/**
 * Result returned by {@link useRotation}.
 */
export type UseRotationResult = {
  inputPath: string | null
  outputPath: string | null
  angle: RotationAngle
  mode: RotationMode
  status: RotationStatus
  /**
   * Latest progress payload from `rotation://progress`, or `null` when no rotation
   * is in flight. Drives the progress bar.
   */
  progress: RotationProgress | null
  /** Wall-clock seconds since the current rotation started. `0` when idle. */
  elapsedSec: number
  /**
   * Estimated seconds remaining based on current progress rate. `null` when
   * progress is too small to estimate or no rotation is running.
   */
  remainingSec: number | null
  setAngle: (value: RotationAngle) => void
  setMode: (value: RotationMode) => void
  handleBrowse: () => Promise<void>
  handleChooseOutput: () => Promise<void>
  handleRotate: () => Promise<void>
  handleReveal: () => Promise<void>
  reset: () => void
}

export function useRotation(): UseRotationResult {
  const { t } = useTranslation()
  const settings = useSelector((state) => state.settings)
  const [inputPath, setInputPath] = useState<string | null>(null)
  const [outputPath, setOutputPath] = useState<string | null>(null)
  const [angle, setAngleLocal] = useState<RotationAngle>(
    settings.rotationAngle ?? 90,
  )
  const [mode, setModeLocal] = useState<RotationMode>(
    settings.rotationMode ?? 'copy',
  )
  const [status, setStatus] = useState<RotationStatus>('idle')
  const [progress, setProgress] = useState<RotationProgress | null>(null)
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null)
  const [finalElapsedSec, setFinalElapsedSec] = useState<number | null>(null)

  // Subscribe to ffmpeg progress events emitted by the Rust side. The
  // listener stays mounted for the hook's lifetime; events are ignored
  // unless a rotation is in flight (status === 'rotating').
  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    void listen<RotationProgress>('rotation://progress', (event) => {
      setProgress(event.payload)
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [])

  // Sync local angle/mode when settings change from outside (e.g. settings dialog)
  useEffect(() => {
    if (settings.rotationAngle && settings.rotationAngle !== angle) {
      setAngleLocal(settings.rotationAngle)
    }
  }, [settings.rotationAngle, angle])

  useEffect(() => {
    if (settings.rotationMode && settings.rotationMode !== mode) {
      setModeLocal(settings.rotationMode)
    }
  }, [settings.rotationMode, mode])

  const setAngle = useCallback(
    (value: RotationAngle) => {
      setAngleLocal(value)
      setStatus('idle')
      const updated = { ...settings, rotationAngle: value } as Settings
      store.dispatch(setSettings(updated))
      callSetSettings(updated).catch((e) => {
        logError(`Failed to save rotation angle: ${e}`)
      })
    },
    [settings],
  )

  const setMode = useCallback(
    (value: RotationMode) => {
      setModeLocal(value)
      setStatus('idle')
      const updated = { ...settings, rotationMode: value } as Settings
      store.dispatch(setSettings(updated))
      callSetSettings(updated).catch((e) => {
        logError(`Failed to save rotation mode: ${e}`)
      })
    },
    [settings],
  )

  const handleBrowse = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    })
    if (typeof selected === 'string') {
      setInputPath(selected)
      // Reset output when input changes to prevent overwriting wrong file
      setOutputPath(null)
      setStatus('idle')
    }
  }, [])

  const handleChooseOutput = useCallback(async () => {
    if (!inputPath) return
    const defaultName = makeDefaultOutputName(inputPath)
    const selected = await save({
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
      defaultPath: defaultName,
    })
    if (typeof selected === 'string') {
      setOutputPath(selected)
      setStatus('idle')
    }
  }, [inputPath])

  const handleReveal = useCallback(async () => {
    if (!outputPath) return
    await invoke('reveal_in_folder', { path: outputPath }).catch((e) => {
      logError(`Failed to reveal in folder: ${e}`)
    })
  }, [outputPath])

  const handleRotate = useCallback(async () => {
    if (!inputPath || !outputPath) return

    setProgress(null)
    setFinalElapsedSec(null)
    const startedAt = Date.now()
    setStartedAtMs(startedAt)
    setStatus('rotating')
    try {
      await rotateVideo({
        inputPath,
        outputPath,
        angle,
        mode,
      })
      setStatus('success')
      setFinalElapsedSec((Date.now() - startedAt) / 1000)
      setProgress((prev) => ({
        progress: 100,
        currentTimeSec: prev?.currentTimeSec ?? 0,
        totalDurationSec: prev?.totalDurationSec ?? 0,
      }))
      toast.success(t('rotation.success'), {
        action: {
          label: t('rotation.openFolder'),
          onClick: () => {
            void handleReveal()
          },
        },
      })
    } catch (e) {
      setStatus('error')
      setProgress(null)
      setFinalElapsedSec(null)
      const raw = e instanceof Error ? e.message : String(e)
      const description = mapRotationError(raw, t)
      toast.error(t('rotation.failed'), { description })
    } finally {
      setStartedAtMs(null)
    }
  }, [inputPath, outputPath, angle, mode, t, handleReveal])

  const reset = useCallback(() => {
    setInputPath(null)
    setOutputPath(null)
    setAngleLocal(90)
    setModeLocal('copy')
    setStatus('idle')
    setProgress(null)
    setStartedAtMs(null)
    setFinalElapsedSec(null)
  }, [])

  // Derive elapsed/remaining on each render. The component re-renders on
  // every progress event (setProgress) so `Date.now()` stays fresh while
  // ffmpeg is running. When idle, both fall back to 0/null.
  const elapsedSec =
    startedAtMs !== null
      ? Math.max(0, (Date.now() - startedAtMs) / 1000)
      : (finalElapsedSec ?? 0)
  // Why: Only estimate remaining once progress exceeds 1%. Below that the
  // rate-based formula is dominated by ffmpeg startup overhead (probe, encoder
  // init) and inflates absurdly (at 0.5% progress the estimate is ~200x the
  // elapsed time, which misleads more than it helps).
  const remainingSec =
    progress && progress.progress > 1
      ? (elapsedSec * (100 - progress.progress)) / progress.progress
      : null

  return {
    inputPath,
    outputPath,
    angle,
    mode,
    status,
    progress,
    elapsedSec,
    remainingSec,
    setAngle,
    setMode,
    handleBrowse,
    handleChooseOutput,
    handleRotate,
    handleReveal,
    reset,
  }
}

/**
 * Builds a sensible default output filename from an input path.
 *
 * Inserts `_rotated` before the extension: `movie.mp4` → `movie_rotated.mp4`.
 * Cross-platform path separator detection via both `/` and `\`.
 */
function makeDefaultOutputName(inputPath: string): string {
  const filename = inputPath.split(/[\\/]/).pop() ?? 'output.mp4'
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return `${filename}_rotated.mp4`
  return `${filename.slice(0, dot)}_rotated.mp4`
}

const ROTATION_ERROR_MAP: Record<string, string> = {
  'ERR::ROTATION_INPUT_NOT_FOUND': 'rotation.error.input_not_found',
  'ERR::ROTATION_UNSUPPORTED_FORMAT': 'rotation.error.unsupported_format',
  'ERR::ROTATION_UNSUPPORTED_OUTPUT_FORMAT':
    'rotation.error.unsupported_output_format',
  'ERR::ROTATION_SAME_PATH': 'rotation.error.same_path',
  'ERR::ROTATION_INVALID_ANGLE': 'rotation.error.invalid_angle',
  'ERR::ROTATION_FFMPEG_FAILED': 'rotation.error.ffmpeg_failed',
}

function mapRotationError(raw: string, t: (key: string) => string): string {
  for (const [code, key] of Object.entries(ROTATION_ERROR_MAP)) {
    if (raw.includes(code)) return t(key)
  }
  return raw
}
