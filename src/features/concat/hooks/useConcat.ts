import { concatVideos } from '../api/concatApi'
import {
  validateConcatFiles,
  type ConcatValidationError,
} from '../lib/validation'
import type { ConcatProgress } from '../types'

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open, save } from '@tauri-apps/plugin-dialog'
import { error as logError } from '@tauri-apps/plugin-log'
import type { TFunction } from 'i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/** Status of the concatenation operation. */
export type ConcatStatus = 'idle' | 'concatting' | 'success' | 'error'

/** Return type of the {@link useConcat} hook exposing all state and handlers. */
export type UseConcatResult = {
  files: string[]
  outputPath: string | null
  status: ConcatStatus
  validationError: ConcatValidationError | null
  progress: ConcatProgress | null
  elapsedSec: number
  remainingSec: number | null
  handleAddFiles: () => Promise<void>
  handleRemoveFile: (index: number) => void
  handleReorderFiles: (fromIndex: number, toIndex: number) => void
  handleChooseOutput: () => Promise<void>
  handleConcat: () => Promise<void>
  handleReveal: () => Promise<void>
  reset: () => void
}

/**
 * Custom hook that manages the video concatenation workflow.
 *
 * Handles file selection, output path, validation, progress tracking,
 * elapsed/remaining time calculation, and cleanup. Listens to Tauri
 * events (`concat://progress`, `concat://fallback`) emitted by the
 * backend during ffmpeg execution.
 */
export function useConcat(): UseConcatResult {
  const { t } = useTranslation()
  const [files, setFiles] = useState<string[]>([])
  const [outputPath, setOutputPath] = useState<string | null>(null)
  const [status, setStatus] = useState<ConcatStatus>('idle')
  const [validationError, setValidationError] =
    useState<ConcatValidationError | null>(null)
  const [progress, setProgress] = useState<ConcatProgress | null>(null)
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null)
  const [finalElapsedSec, setFinalElapsedSec] = useState<number | null>(null)
  const [, setTick] = useState(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let cancelled = false
    const unlisteners: UnlistenFn[] = []

    void listen<ConcatProgress>('concat://progress', (event) => {
      setProgress(event.payload)
    }).then((fn) => {
      if (cancelled) fn()
      else unlisteners.push(fn)
    })

    void listen('concat://fallback', () => {
      setProgress(null)
      setStartedAtMs(Date.now())
      toast.info(t('concat.fallbackNotice'))
    }).then((fn) => {
      if (cancelled) fn()
      else unlisteners.push(fn)
    })

    return () => {
      cancelled = true
      unlisteners.forEach((fn) => fn())
    }
  }, [t])

  const resetStatus = useCallback(() => {
    setStatus('idle')
    setValidationError(null)
  }, [])

  const handleAddFiles = useCallback(async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
    })
    if (Array.isArray(selected) && selected.length > 0) {
      setFiles((prev) => [...prev, ...selected])
      resetStatus()
    }
  }, [resetStatus])

  const handleRemoveFile = useCallback(
    (index: number) => {
      setFiles((prev) => prev.filter((_, i) => i !== index))
      resetStatus()
    },
    [resetStatus],
  )

  const handleReorderFiles = useCallback(
    (fromIndex: number, toIndex: number) => {
      setFiles((prev) => {
        const next = [...prev]
        const [moved] = next.splice(fromIndex, 1)
        next.splice(toIndex, 0, moved)
        return next
      })
      resetStatus()
    },
    [resetStatus],
  )

  const handleChooseOutput = useCallback(async () => {
    const selected = await save({
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }],
      defaultPath: 'concat_output.mp4',
    })
    if (typeof selected === 'string') {
      setOutputPath(selected)
      resetStatus()
    }
  }, [resetStatus])

  const handleReveal = useCallback(async () => {
    if (!outputPath) return
    await invoke('reveal_in_folder', { path: outputPath }).catch((e) => {
      logError(`Failed to reveal in folder: ${e}`)
    })
  }, [outputPath])

  const handleConcat = useCallback(async () => {
    const error = validateConcatFiles(files)
    if (error) {
      setValidationError(error)
      return
    }
    if (!outputPath) return
    setValidationError(null)
    setProgress(null)
    setFinalElapsedSec(null)
    const startedAt = Date.now()
    setStartedAtMs(startedAt)
    setStatus('concatting')
    tickRef.current = setInterval(() => setTick((n) => n + 1), 1000)
    try {
      await concatVideos({ inputPaths: files, outputPath })
      setStatus('success')
      setFinalElapsedSec((Date.now() - startedAt) / 1000)
      setProgress((prev) => ({
        progress: 100,
        currentTimeSec: prev?.currentTimeSec ?? 0,
        totalDurationSec: prev?.totalDurationSec ?? 0,
      }))
      toast.success(t('concat.success'), {
        action: {
          label: t('concat.openFolder'),
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
      toast.error(t('concat.failed'), {
        description: mapConcatError(raw, t),
      })
    } finally {
      if (tickRef.current) {
        clearInterval(tickRef.current)
        tickRef.current = null
      }
      setStartedAtMs(null)
    }
  }, [files, outputPath, t, handleReveal])

  const reset = useCallback(() => {
    setFiles([])
    setOutputPath(null)
    setStatus('idle')
    setValidationError(null)
    setProgress(null)
    setStartedAtMs(null)
    setFinalElapsedSec(null)
  }, [])

  const elapsedSec =
    startedAtMs !== null
      ? Math.max(0, (Date.now() - startedAtMs) / 1000)
      : (finalElapsedSec ?? 0)
  const remainingSec =
    progress && progress.progress > 1
      ? (elapsedSec * (100 - progress.progress)) / progress.progress
      : null

  return {
    files,
    outputPath,
    status,
    validationError,
    progress,
    elapsedSec,
    remainingSec,
    handleAddFiles,
    handleRemoveFile,
    handleReorderFiles,
    handleChooseOutput,
    handleConcat,
    handleReveal,
    reset,
  }
}

/** Maps backend `ERR::*` error codes to i18n translation keys. */
const CONCAT_ERROR_MAP: Record<string, string> = {
  'ERR::CONCAT_TOO_FEW_FILES': 'concat.error.too_few_files',
  'ERR::CONCAT_FILE_NOT_FOUND': 'concat.error.file_not_found',
  'ERR::CONCAT_UNSUPPORTED_FORMAT': 'concat.error.unsupported_format',
  'ERR::CONCAT_UNSUPPORTED_OUTPUT_FORMAT':
    'concat.error.unsupported_output_format',
  'ERR::CONCAT_OUTPUT_COLLISION': 'concat.error.output_collision',
  'ERR::CONCAT_FFMPEG_FAILED': 'concat.error.ffmpeg_failed',
  'ERR::CONCAT_REENCODE_FAILED': 'concat.error.reencode_failed',
}

/**
 * Translates a raw backend error string into a localized user-facing
 * message. Matches known `ERR::*` codes against `CONCAT_ERROR_MAP`;
 * falls back to the raw string if no mapping is found.
 *
 * @param raw - The raw error string from the backend.
 * @param t - The i18next translation function.
 * @returns A localized error message string.
 */
function mapConcatError(raw: string, t: TFunction): string {
  for (const [code, key] of Object.entries(CONCAT_ERROR_MAP)) {
    if (raw.includes(code)) return t(key)
  }
  return raw
}
