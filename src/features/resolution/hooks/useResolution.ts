/**
 * Resolution feature hook.
 *
 * Encapsulates all state and orchestration for the resolution conversion
 * page: file dialogs, target-height selection (preset or custom), best-effort
 * preset auto-select on input load, and invocation of `extract_resolution`.
 * The target height is recomputed per input because it depends on the source
 * resolution (up-scaling is disabled).
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open, save } from '@tauri-apps/plugin-dialog'
import { error as logError } from '@tauri-apps/plugin-log'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { extractResolution, probeVideoResolution } from '../api/resolutionApi'
import {
  DEFAULT_TARGET_HEIGHT,
  getEnabledResolutions,
  selectBestEffortResolution,
} from '../lib/resolution'
import type { ResolutionProgress } from '../types'

export type ResolutionStatus =
  | 'idle'
  | 'probing'
  | 'converting'
  | 'success'
  | 'error'

/**
 * Result returned by {@link useResolution}.
 */
export type UseResolutionResult = {
  inputPath: string | null
  outputPath: string | null
  targetHeight: number
  isCustomHeight: boolean
  /** Presets selectable for the current input (gated by source height). */
  enabledResolutions: readonly number[]
  /** Probed source video resolution (width × height), or `null` when unknown. */
  inputResolution: { width: number; height: number } | null
  status: ResolutionStatus
  /**
   * Latest progress payload from `resolution://progress`, or `null` when no
   * conversion is in flight. Drives the progress bar.
   */
  progress: ResolutionProgress | null
  /** Wall-clock seconds since the current conversion started. `0` when idle. */
  elapsedSec: number
  /**
   * Estimated seconds remaining based on current progress rate. `null` when
   * progress is too small to estimate or no conversion is running.
   */
  remainingSec: number | null
  setTargetHeight: (value: number) => void
  setIsCustomHeight: (value: boolean) => void
  handleBrowse: () => Promise<void>
  handleChooseOutput: () => Promise<void>
  handleConvert: () => Promise<void>
  handleReveal: () => Promise<void>
  reset: () => void
}

export function useResolution(): UseResolutionResult {
  const { t } = useTranslation()
  const [inputPath, setInputPath] = useState<string | null>(null)
  const [outputPath, setOutputPath] = useState<string | null>(null)
  const [targetHeight, setTargetHeightLocal] = useState<number>(
    DEFAULT_TARGET_HEIGHT,
  )
  const [isCustomHeight, setIsCustomHeightLocal] = useState<boolean>(false)
  const [inputResolution, setInputResolution] = useState<{
    width: number
    height: number
  } | null>(null)
  const [status, setStatus] = useState<ResolutionStatus>('idle')
  const [progress, setProgress] = useState<ResolutionProgress | null>(null)
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null)
  const [finalElapsedSec, setFinalElapsedSec] = useState<number | null>(null)

  // Subscribe to ffmpeg progress events emitted by the Rust side. The
  // listener stays mounted for the hook's lifetime; events are ignored
  // unless a conversion is in flight.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    void listen<ResolutionProgress>('resolution://progress', (event) => {
      setProgress(event.payload)
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [])

  const enabledResolutions = getEnabledResolutions(
    inputResolution?.height ?? null,
  )

  const setTargetHeight = useCallback((value: number) => {
    setTargetHeightLocal(value)
    setStatus('idle')
    // CAUTION: reset output path so the filename is updated with the new
    // height on re-select (the default name embeds the target height).
    setOutputPath(null)
  }, [])

  const setIsCustomHeight = useCallback((value: boolean) => {
    setIsCustomHeightLocal(value)
    setStatus('idle')
  }, [])

  const handleBrowse = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    })
    if (typeof selected === 'string') {
      setInputPath(selected)
      setOutputPath(null)
      setStatus('probing')
      setInputResolution(null)
      // Probe source video resolution to drive preset enablement + auto-select.
      const resolution = await probeVideoResolution(selected).catch((e) => {
        logError(`Failed to probe video resolution: ${e}`)
        return null
      })
      setInputResolution(resolution)
      // Auto-pick the best-effort preset when not in custom mode so the
      // selected height never silently up-scales the new input.
      if (!isCustomHeight) {
        setTargetHeightLocal(
          selectBestEffortResolution(resolution?.height ?? null),
        )
      }
      setStatus('idle')
    }
  }, [isCustomHeight])

  const handleChooseOutput = useCallback(async () => {
    if (!inputPath) return
    const defaultName = makeDefaultOutputName(inputPath, targetHeight)
    const selected = await save({
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
      defaultPath: defaultName,
    })
    if (typeof selected === 'string') {
      setOutputPath(selected)
      setStatus('idle')
    }
  }, [inputPath, targetHeight])

  const handleReveal = useCallback(async () => {
    if (!outputPath) return
    await invoke('reveal_in_folder', { path: outputPath }).catch((e) => {
      logError(`Failed to reveal in folder: ${e}`)
    })
  }, [outputPath])

  const handleConvert = useCallback(async () => {
    if (!inputPath || !outputPath) return
    setProgress(null)
    setFinalElapsedSec(null)
    const startedAt = Date.now()
    setStartedAtMs(startedAt)
    setStatus('converting')
    try {
      await extractResolution({
        inputPath,
        outputPath,
        targetHeight,
      })
      setStatus('success')
      setFinalElapsedSec((Date.now() - startedAt) / 1000)
      setProgress((prev) => ({
        progress: 100,
        currentTimeSec: prev?.currentTimeSec ?? 0,
        totalDurationSec: prev?.totalDurationSec ?? 0,
      }))
      toast.success(t('resolution.success'), {
        action: {
          label: t('resolution.openFolder'),
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
      const description = mapResolutionError(raw, t)
      toast.error(t('resolution.failed'), { description })
    } finally {
      setStartedAtMs(null)
    }
  }, [inputPath, outputPath, targetHeight, t, handleReveal])

  const reset = useCallback(() => {
    setInputPath(null)
    setOutputPath(null)
    setTargetHeightLocal(DEFAULT_TARGET_HEIGHT)
    setIsCustomHeightLocal(false)
    setInputResolution(null)
    setStatus('idle')
    setProgress(null)
    setStartedAtMs(null)
    setFinalElapsedSec(null)
  }, [])

  // Derive elapsed/remaining on each render (same approach as useAudio).
  const elapsedSec =
    startedAtMs !== null
      ? Math.max(0, (Date.now() - startedAtMs) / 1000)
      : (finalElapsedSec ?? 0)
  const remainingSec =
    progress && progress.progress > 1
      ? (elapsedSec * (100 - progress.progress)) / progress.progress
      : null

  return {
    inputPath,
    outputPath,
    targetHeight,
    isCustomHeight,
    enabledResolutions,
    inputResolution,
    status,
    progress,
    elapsedSec,
    remainingSec,
    setTargetHeight,
    setIsCustomHeight,
    handleBrowse,
    handleChooseOutput,
    handleConvert,
    handleReveal,
    reset,
  }
}

/**
 * Builds a sensible default output filename from an input path and target height.
 *
 * Inserts `_resolution<H>` before the extension:
 * `movie.mp4` → `movie_resolution720.mp4`. Cross-platform path separator
 * detection via both `/` and `\`.
 */
function makeDefaultOutputName(
  inputPath: string,
  targetHeight: number,
): string {
  const filename = inputPath.split(/[\\/]/).pop() ?? `output.mp4`
  const dot = filename.lastIndexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  return `${base}_resolution${targetHeight}.mp4`
}

const RESOLUTION_ERROR_MAP: Record<string, string> = {
  'ERR::RESOLUTION_INPUT_NOT_FOUND': 'resolution.error.input_not_found',
  'ERR::RESOLUTION_UNSUPPORTED_FORMAT': 'resolution.error.unsupported_format',
  'ERR::RESOLUTION_UNSUPPORTED_OUTPUT_FORMAT':
    'resolution.error.unsupported_output_format',
  'ERR::RESOLUTION_SAME_PATH': 'resolution.error.same_path',
  'ERR::RESOLUTION_INVALID_HEIGHT': 'resolution.error.invalid_height',
  'ERR::RESOLUTION_FFMPEG_FAILED': 'resolution.error.ffmpeg_failed',
}

function mapResolutionError(raw: string, t: (key: string) => string): string {
  for (const [code, key] of Object.entries(RESOLUTION_ERROR_MAP)) {
    if (raw.includes(code)) return t(key)
  }
  return raw
}
