/**
 * GIF/WebM generator feature hook.
 *
 * Encapsulates all state and orchestration for the GIF page: file dialogs,
 * form fields (range / format / width / fps), validation gating, and
 * invocation of `generate_animation`. Components consume the returned plain
 * props — no Redux involvement needed because generation is a one-shot,
 * stateless operation. The only persisted piece is the default format
 * (`settings.gifFormat`).
 */

import { store, useSelector } from '@/app/store'
import { callPatchSettings } from '@/features/settings/api/settingApi'
import { setSettings } from '@/features/settings/settingsSlice'
import { toast } from '@/shared/ui/toast'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open, save } from '@tauri-apps/plugin-dialog'
import { error as logError } from '@tauri-apps/plugin-log'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { generateAnimation, probeVideoResolution } from '../api/gifApi'
import {
  parseTimecode,
  validateGifRange,
  type GifRangeError,
} from '../lib/validation'
import type {
  GifFormat,
  GifFpsPreset,
  GifProgress,
  GifWidthPreset,
} from '../types'

export type GifStatus = 'idle' | 'generating' | 'success' | 'error'

/** Default width preset when no input has been picked yet. */
export const DEFAULT_WIDTH_PRESET: GifWidthPreset = '480'
/** Default FPS preset. */
export const DEFAULT_FPS_PRESET: GifFpsPreset = '15'

/**
 * Result returned by {@link useGif}.
 */
export type UseGifResult = {
  inputPath: string | null
  outputPath: string | null
  start: string
  end: string
  format: GifFormat
  widthPreset: GifWidthPreset
  fps: GifFpsPreset
  /** Probed source width in px, for the "Original" label. `null` when the probe failed or nothing is picked. */
  sourceWidth: number | null
  status: GifStatus
  rangeError: GifRangeError | null
  /**
   * Latest progress payload from `gif://progress`, or `null` when no
   * generation is in flight. Drives the progress bar.
   */
  progress: GifProgress | null
  /** Wall-clock seconds since the current generation started. `0` when idle. */
  elapsedSec: number
  /**
   * Estimated seconds remaining based on current progress rate. `null` when
   * progress is too small to estimate or nothing is running.
   */
  remainingSec: number | null
  setStart: (value: string) => void
  setEnd: (value: string) => void
  setFormat: (value: GifFormat) => void
  setWidthPreset: (value: GifWidthPreset) => void
  setFps: (value: GifFpsPreset) => void
  handleBrowse: () => Promise<void>
  handleChooseOutput: () => Promise<void>
  handleGenerate: () => Promise<void>
  handleReveal: () => Promise<void>
  reset: () => void
}

export function useGif(): UseGifResult {
  const { t } = useTranslation()
  const settings = useSelector((state) => state.settings)
  const [inputPath, setInputPath] = useState<string | null>(null)
  const [outputPath, setOutputPath] = useState<string | null>(null)
  const [start, setStartRaw] = useState('')
  const [end, setEndRaw] = useState('')
  const [format, setFormatLocal] = useState<GifFormat>(
    settings.gifFormat ?? 'gif',
  )
  const [widthPreset, setWidthPresetState] =
    useState<GifWidthPreset>(DEFAULT_WIDTH_PRESET)
  const [fps, setFpsState] = useState<GifFpsPreset>(DEFAULT_FPS_PRESET)
  const [sourceWidth, setSourceWidth] = useState<number | null>(null)
  const [status, setStatus] = useState<GifStatus>('idle')
  const [rangeError, setRangeError] = useState<GifRangeError | null>(null)
  const [progress, setProgress] = useState<GifProgress | null>(null)
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null)
  const [finalElapsedSec, setFinalElapsedSec] = useState<number | null>(null)

  // Subscribe to ffmpeg progress events emitted by the Rust side. The
  // listener stays mounted for the hook's lifetime; events are ignored
  // unless a generation is in flight (status === 'generating').
  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    void listen<GifProgress>('gif://progress', (event) => {
      setProgress(event.payload)
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [])

  // Sync local format when settings change from outside (e.g. settings page)
  useEffect(() => {
    if (settings.gifFormat && settings.gifFormat !== format) {
      setFormatLocal(settings.gifFormat)
    }
  }, [settings.gifFormat, format])

  // Wrappers that reset status to 'idle' so the completed progress bar
  // disappears and the Generate button re-enables the moment the user
  // tweaks any condition after a successful run.
  const setStart = useCallback((value: string) => {
    setStartRaw(value)
    setStatus('idle')
  }, [])
  const setEnd = useCallback((value: string) => {
    setEndRaw(value)
    setStatus('idle')
  }, [])
  const setWidthPreset = useCallback((value: GifWidthPreset) => {
    setWidthPresetState(value)
    setStatus('idle')
  }, [])
  const setFps = useCallback((value: GifFpsPreset) => {
    setFpsState(value)
    setStatus('idle')
  }, [])

  const setFormat = useCallback((value: GifFormat) => {
    setFormatLocal(value)
    setStatus('idle')
    // Keep an already-picked output path usable: swap the extension so it
    // always matches the new format (avoids ERR::GIF_UNSUPPORTED_OUTPUT_FORMAT).
    setOutputPath((prev) => (prev ? swapExtension(prev, value) : prev))
    store.dispatch(setSettings({ gifFormat: value }))
    callPatchSettings({ gifFormat: value }).catch((e) => {
      logError(`Failed to save gif format: ${e}`)
    })
  }, [])

  const handleBrowse = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    })
    if (typeof selected === 'string') {
      setInputPath(selected)
      // Reset the output path whenever the input changes (overwrite safety)
      setOutputPath(null)
      setStatus('idle')
      // Display-only probe: on failure keep `null` and show the plain
      // "Original" label — generation does not depend on it.
      const resolution = await probeVideoResolution(selected).catch((e) => {
        logError(`Failed to probe video resolution: ${e}`)
        return null
      })
      setSourceWidth(resolution?.width ?? null)
    }
  }, [])

  const handleChooseOutput = useCallback(async () => {
    if (!inputPath) return
    const defaultName = makeDefaultOutputName(inputPath, format)
    const selected = await save({
      filters: [
        {
          name: format === 'gif' ? 'GIF Animation' : 'WebM Video',
          extensions: [format],
        },
      ],
      defaultPath: defaultName,
    })
    if (typeof selected === 'string') {
      setOutputPath(selected)
      setStatus('idle')
    }
  }, [inputPath, format])

  const handleReveal = useCallback(async () => {
    if (!outputPath) return
    await invoke('reveal_in_folder', { path: outputPath }).catch((e) => {
      logError(`Failed to reveal in folder: ${e}`)
    })
  }, [outputPath])

  const handleGenerate = useCallback(async () => {
    if (!inputPath || !outputPath) return
    const error = validateGifRange(start, end)
    if (error) {
      setRangeError(error)
      return
    }
    setRangeError(null)
    setProgress(null)
    setFinalElapsedSec(null)
    const startedAt = Date.now()
    setStartedAtMs(startedAt)
    setStatus('generating')
    try {
      await generateAnimation({
        inputPath,
        outputPath,
        startTime: parseTimecode(start) as number,
        endTime: parseTimecode(end) as number,
        format,
        width: widthPreset === 'original' ? null : Number(widthPreset),
        fps: Number(fps),
      })
      setStatus('success')
      setFinalElapsedSec((Date.now() - startedAt) / 1000)
      setProgress((prev) => ({
        progress: 100,
        currentTimeSec: prev?.currentTimeSec ?? 0,
        totalDurationSec: prev?.totalDurationSec ?? 0,
      }))
      toast.success(t('gif.success'), {
        action: {
          label: t('gif.openFolder'),
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
      const description = mapGifError(raw, t)
      toast.error(t('gif.failed'), { description })
    } finally {
      setStartedAtMs(null)
    }
  }, [
    inputPath,
    outputPath,
    start,
    end,
    format,
    widthPreset,
    fps,
    t,
    handleReveal,
  ])

  const reset = useCallback(() => {
    setInputPath(null)
    setOutputPath(null)
    setStart('')
    setEnd('')
    setWidthPresetState(DEFAULT_WIDTH_PRESET)
    setFpsState(DEFAULT_FPS_PRESET)
    setSourceWidth(null)
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
    format,
    widthPreset,
    fps,
    sourceWidth,
    status,
    rangeError,
    progress,
    elapsedSec,
    remainingSec,
    setStart,
    setEnd,
    setFormat,
    setWidthPreset,
    setFps,
    handleBrowse,
    handleChooseOutput,
    handleGenerate,
    handleReveal,
    reset,
  }
}

/**
 * Builds a sensible default output filename from an input path.
 *
 * Appends `_clip` plus the format extension: `movie.mp4` →
 * `movie_clip.gif` / `movie_clip.webm`. Cross-platform path separator
 * detection via both `/` and `\`.
 */
export function makeDefaultOutputName(
  inputPath: string,
  format: GifFormat,
): string {
  const filename = inputPath.split(/[\\/]/).pop() ?? `output.${format}`
  const dot = filename.lastIndexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  return `${base}_clip.${format}`
}

/** Replaces the extension of a picked output path to match a new format. */
function swapExtension(path: string, format: GifFormat): string {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const dot = path.lastIndexOf('.')
  if (dot <= slash) return `${path}.${format}`
  return `${path.slice(0, dot)}.${format}`
}

const GIF_ERROR_MAP: Record<string, string> = {
  'ERR::GIF_INPUT_NOT_FOUND': 'gif.error.input_not_found',
  'ERR::GIF_UNSUPPORTED_FORMAT': 'gif.error.unsupported_format',
  'ERR::GIF_UNSUPPORTED_OUTPUT_FORMAT': 'gif.error.unsupported_output_format',
  'ERR::GIF_SAME_PATH': 'gif.error.same_path',
  'ERR::GIF_INVALID_RANGE': 'gif.error.invalid_range',
  'ERR::GIF_FFMPEG_FAILED': 'gif.error.ffmpeg_failed',
}

function mapGifError(raw: string, t: (key: string) => string): string {
  for (const [code, key] of Object.entries(GIF_ERROR_MAP)) {
    if (raw.includes(code)) return t(key)
  }
  return raw
}
