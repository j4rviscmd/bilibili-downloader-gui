/**
 * Audio feature hook.
 *
 * Encapsulates all state and orchestration for the audio extraction page:
 * file dialogs, format/bitrate selection, best-effort bitrate auto-select
 * on input load, and invocation of `extract_audio`. The output format is
 * persisted to settings (like trim's mode); the bitrate is recomputed per
 * input because it depends on the source audio bitrate.
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

import { extractAudio, probeAudioBitrate } from '../api/audioApi'
import {
  getEnabledPresets,
  selectBestEffortBitrate,
  type BitratePreset,
} from '../lib/bitrate'
import type { AudioFormat, AudioProgress } from '../types'

export type AudioStatus =
  | 'idle'
  | 'probing'
  | 'extracting'
  | 'success'
  | 'error'

/**
 * Result returned by {@link useAudio}.
 */
export type UseAudioResult = {
  inputPath: string | null
  outputPath: string | null
  format: AudioFormat
  bitrateKbps: number
  /** Presets selectable for the current input (gated by source bitrate). */
  enabledBitrates: readonly BitratePreset[]
  /** Probed source audio bitrate in kbps, or `null` when unknown (VBR). */
  inputBitrate: number | null
  status: AudioStatus
  /**
   * Latest progress payload from `audio://progress`, or `null` when no
   * extraction is in flight. Drives the progress bar.
   */
  progress: AudioProgress | null
  /** Wall-clock seconds since the current extraction started. `0` when idle. */
  elapsedSec: number
  /**
   * Estimated seconds remaining based on current progress rate. `null` when
   * progress is too small to estimate or no extraction is running.
   */
  remainingSec: number | null
  setFormat: (value: AudioFormat) => void
  setBitrateKbps: (value: number) => void
  handleBrowse: () => Promise<void>
  handleChooseOutput: () => Promise<void>
  handleExtract: () => Promise<void>
  handleReveal: () => Promise<void>
  reset: () => void
}

export function useAudio(): UseAudioResult {
  const { t } = useTranslation()
  const settings = useSelector((state) => state.settings)
  const [inputPath, setInputPath] = useState<string | null>(null)
  const [outputPath, setOutputPath] = useState<string | null>(null)
  const [format, setFormatLocal] = useState<AudioFormat>(
    settings.audioFormat ?? 'mp3',
  )
  const [bitrateKbps, setBitrateKbps] = useState<number>(192)
  const [inputBitrate, setInputBitrate] = useState<number | null>(null)
  const [status, setStatus] = useState<AudioStatus>('idle')
  const [progress, setProgress] = useState<AudioProgress | null>(null)
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null)
  const [finalElapsedSec, setFinalElapsedSec] = useState<number | null>(null)

  // Subscribe to ffmpeg progress events emitted by the Rust side. The
  // listener stays mounted for the hook's lifetime; events are ignored
  // unless an extraction is in flight.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    void listen<AudioProgress>('audio://progress', (event) => {
      setProgress(event.payload)
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [])

  // Sync local format when settings change from outside (e.g. settings dialog)
  useEffect(() => {
    if (settings.audioFormat && settings.audioFormat !== format) {
      setFormatLocal(settings.audioFormat)
    }
  }, [settings.audioFormat, format])

  const enabledBitrates = getEnabledPresets(inputBitrate)

  const setFormat = useCallback(
    (value: AudioFormat) => {
      setFormatLocal(value)
      setStatus('idle')
      // CAUTION: reset output path so its extension matches the new format
      // on re-select (the save dialog filters by the chosen extension).
      setOutputPath(null)
      const updated = { ...settings, audioFormat: value } as Settings
      store.dispatch(setSettings(updated))
      callSetSettings(updated).catch((e) => {
        logError(`Failed to save audio format: ${e}`)
      })
    },
    [settings],
  )

  // Wrapper that resets status to 'idle' so the completed progress bar
  // disappears and the Extract button re-enables the moment the user tweaks
  // any condition after a successful extraction.
  const setBitrateKbpsWrapper = useCallback((value: number) => {
    setBitrateKbps(value)
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
      setInputBitrate(null)
      // Probe source audio bitrate to drive preset enablement + auto-select.
      const bitrate = await probeAudioBitrate(selected).catch((e) => {
        logError(`Failed to probe audio bitrate: ${e}`)
        return null
      })
      setInputBitrate(bitrate)
      setBitrateKbps(selectBestEffortBitrate(bitrate))
      setStatus('idle')
    }
  }, [])

  const handleChooseOutput = useCallback(async () => {
    if (!inputPath) return
    const defaultName = makeDefaultOutputName(inputPath, format)
    const selected = await save({
      filters: [
        {
          name: format === 'mp3' ? 'MP3 Audio' : 'AAC Audio (M4A)',
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

  const handleExtract = useCallback(async () => {
    if (!inputPath || !outputPath) return
    setProgress(null)
    setFinalElapsedSec(null)
    const startedAt = Date.now()
    setStartedAtMs(startedAt)
    setStatus('extracting')
    try {
      await extractAudio({
        inputPath,
        outputPath,
        format,
        bitrateKbps,
      })
      setStatus('success')
      setFinalElapsedSec((Date.now() - startedAt) / 1000)
      setProgress((prev) => ({
        progress: 100,
        currentTimeSec: prev?.currentTimeSec ?? 0,
        totalDurationSec: prev?.totalDurationSec ?? 0,
      }))
      toast.success(t('audio.success'), {
        action: {
          label: t('audio.openFolder'),
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
      const description = mapAudioError(raw, t)
      toast.error(t('audio.failed'), { description })
    } finally {
      setStartedAtMs(null)
    }
  }, [inputPath, outputPath, format, bitrateKbps, t, handleReveal])

  const reset = useCallback(() => {
    setInputPath(null)
    setOutputPath(null)
    setFormatLocal('mp3')
    setBitrateKbps(192)
    setInputBitrate(null)
    setStatus('idle')
    setProgress(null)
    setStartedAtMs(null)
    setFinalElapsedSec(null)
  }, [])

  // Derive elapsed/remaining on each render (same approach as useTrim).
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
    format,
    bitrateKbps,
    enabledBitrates,
    inputBitrate,
    status,
    progress,
    elapsedSec,
    remainingSec,
    setFormat,
    setBitrateKbps: setBitrateKbpsWrapper,
    handleBrowse,
    handleChooseOutput,
    handleExtract,
    handleReveal,
    reset,
  }
}

/**
 * Builds a sensible default output filename from an input path and format.
 *
 * Inserts `_audio` before the extension and switches to the target format:
 * `movie.mp4` → `movie_audio.mp3`. Cross-platform path separator detection
 * via both `/` and `\`.
 */
function makeDefaultOutputName(inputPath: string, format: AudioFormat): string {
  const filename = inputPath.split(/[\\/]/).pop() ?? `output.${format}`
  const dot = filename.lastIndexOf('.')
  const base = dot > 0 ? filename.slice(0, dot) : filename
  return `${base}_audio.${format}`
}

const AUDIO_ERROR_MAP: Record<string, string> = {
  'ERR::AUDIO_INPUT_NOT_FOUND': 'audio.error.input_not_found',
  'ERR::AUDIO_UNSUPPORTED_FORMAT': 'audio.error.unsupported_format',
  'ERR::AUDIO_UNSUPPORTED_OUTPUT_FORMAT':
    'audio.error.unsupported_output_format',
  'ERR::AUDIO_SAME_PATH': 'audio.error.same_path',
  'ERR::AUDIO_INVALID_BITRATE': 'audio.error.invalid_bitrate',
  'ERR::AUDIO_FFMPEG_FAILED': 'audio.error.ffmpeg_failed',
}

function mapAudioError(raw: string, t: (key: string) => string): string {
  for (const [code, key] of Object.entries(AUDIO_ERROR_MAP)) {
    if (raw.includes(code)) return t(key)
  }
  return raw
}
