/**
 * Trim feature hook.
 *
 * Encapsulates all state and orchestration for the trim page: file dialogs,
 * form fields, validation gating, and invocation of `trim_video`. Components
 * consume the returned plain props — no Redux involvement needed because
 * trim is a one-shot, stateless operation.
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

import { trimVideo } from '../api/trimApi'
import {
  parseTimecode,
  validateTrimRange,
  type TrimRangeError,
} from '../lib/validation'
import type { TrimMode, TrimProgress } from '../types'

export type TrimStatus = 'idle' | 'trimming' | 'success' | 'error'

/**
 * Result returned by {@link useTrim}.
 */
export type UseTrimResult = {
  inputPath: string | null
  outputPath: string | null
  start: string
  end: string
  mode: TrimMode
  status: TrimStatus
  rangeError: TrimRangeError | null
  /**
   * Latest progress payload from `trim://progress`, or `null` when no trim
   * is in flight. Drives the progress bar.
   */
  progress: TrimProgress | null
  /** Wall-clock seconds since the current trim started. `0` when idle. */
  elapsedSec: number
  /**
   * Estimated seconds remaining based on current progress rate. `null` when
   * progress is too small to estimate or no trim is running.
   */
  remainingSec: number | null
  setStart: (value: string) => void
  setEnd: (value: string) => void
  setMode: (value: TrimMode) => void
  handleBrowse: () => Promise<void>
  handleChooseOutput: () => Promise<void>
  handleTrim: () => Promise<void>
  handleReveal: () => Promise<void>
  reset: () => void
}

export function useTrim(): UseTrimResult {
  const { t } = useTranslation()
  const settings = useSelector((state) => state.settings)
  const [inputPath, setInputPath] = useState<string | null>(null)
  const [outputPath, setOutputPath] = useState<string | null>(null)
  const [start, setStartRaw] = useState('')
  const [end, setEndRaw] = useState('')
  const [mode, setModeLocal] = useState<TrimMode>(settings.trimMode ?? 'copy')
  const [status, setStatus] = useState<TrimStatus>('idle')
  const [rangeError, setRangeError] = useState<TrimRangeError | null>(null)
  const [progress, setProgress] = useState<TrimProgress | null>(null)
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null)
  const [finalElapsedSec, setFinalElapsedSec] = useState<number | null>(null)

  // Subscribe to ffmpeg progress events emitted by the Rust side. The
  // listener stays mounted for the hook's lifetime; events are ignored
  // unless a trim is in flight (status === 'trimming').
  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    void listen<TrimProgress>('trim://progress', (event) => {
      setProgress(event.payload)
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [])

  // Sync local mode when settings change from outside (e.g. settings dialog)
  useEffect(() => {
    if (settings.trimMode && settings.trimMode !== mode) {
      setModeLocal(settings.trimMode)
    }
  }, [settings.trimMode, mode])

  // Wrappers that reset status to 'idle' so the completed progress bar
  // disappears and the Trim button re-enables the moment the user tweaks
  // any condition after a successful trim.
  const setStart = useCallback((value: string) => {
    setStartRaw(value)
    setStatus('idle')
  }, [])
  const setEnd = useCallback((value: string) => {
    setEndRaw(value)
    setStatus('idle')
  }, [])

  const setMode = useCallback(
    (value: TrimMode) => {
      setModeLocal(value)
      setStatus('idle')
      const updated = { ...settings, trimMode: value } as Settings
      store.dispatch(setSettings(updated))
      callSetSettings(updated).catch((e) => {
        logError(`Failed to save trim mode: ${e}`)
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
      // 入力が変わったら出力パスもリセット（上書き事故防止）
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

  const handleTrim = useCallback(async () => {
    if (!inputPath || !outputPath) return
    const error = validateTrimRange(start, end)
    if (error) {
      setRangeError(error)
      return
    }
    setRangeError(null)
    setProgress(null)
    setFinalElapsedSec(null)
    const startedAt = Date.now()
    setStartedAtMs(startedAt)
    setStatus('trimming')
    try {
      await trimVideo({
        inputPath,
        outputPath,
        startTime: parseTimecode(start),
        endTime: parseTimecode(end),
        mode,
      })
      setStatus('success')
      setFinalElapsedSec((Date.now() - startedAt) / 1000)
      setProgress((prev) => ({
        progress: 100,
        currentTimeSec: prev?.currentTimeSec ?? 0,
        totalDurationSec: prev?.totalDurationSec ?? 0,
      }))
      toast.success(t('trim.success'), {
        action: {
          label: t('trim.openFolder'),
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
      const description = mapTrimError(raw, t)
      toast.error(t('trim.failed'), { description })
    } finally {
      setStartedAtMs(null)
    }
  }, [inputPath, outputPath, start, end, mode, t, handleReveal])

  const reset = useCallback(() => {
    setInputPath(null)
    setOutputPath(null)
    setStart('')
    setEnd('')
    setModeLocal('copy')
    setStatus('idle')
    setRangeError(null)
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
  const remainingSec =
    progress && progress.progress > 1
      ? (elapsedSec * (100 - progress.progress)) / progress.progress
      : null

  return {
    inputPath,
    outputPath,
    start,
    end,
    mode,
    status,
    rangeError,
    progress,
    elapsedSec,
    remainingSec,
    setStart,
    setEnd,
    setMode,
    handleBrowse,
    handleChooseOutput,
    handleTrim,
    handleReveal,
    reset,
  }
}

/**
 * Builds a sensible default output filename from an input path.
 *
 * Inserts `_trimmed` before the extension: `movie.mp4` → `movie_trimmed.mp4`.
 * Cross-platform path separator detection via both `/` and `\`.
 */
function makeDefaultOutputName(inputPath: string): string {
  const filename = inputPath.split(/[\\/]/).pop() ?? 'output.mp4'
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return `${filename}_trimmed.mp4`
  return `${filename.slice(0, dot)}_trimmed.mp4`
}

const TRIM_ERROR_MAP: Record<string, string> = {
  'ERR::TRIM_INPUT_NOT_FOUND': 'trim.error.input_not_found',
  'ERR::TRIM_UNSUPPORTED_FORMAT': 'trim.error.unsupported_format',
  'ERR::TRIM_UNSUPPORTED_OUTPUT_FORMAT': 'trim.error.unsupported_output_format',
  'ERR::TRIM_SAME_PATH': 'trim.error.same_path',
  'ERR::TRIM_NO_RANGE': 'trim.error.no_range',
  'ERR::TRIM_INVALID_RANGE': 'trim.error.invalid_range',
  'ERR::TRIM_FFMPEG_FAILED': 'trim.error.ffmpeg_failed',
}

function mapTrimError(raw: string, t: (key: string) => string): string {
  for (const [code, key] of Object.entries(TRIM_ERROR_MAP)) {
    if (raw.includes(code)) return t(key)
  }
  return raw
}
