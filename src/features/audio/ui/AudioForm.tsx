/**
 * Audio extraction form UI.
 *
 * Layout follows the trim page pattern: input file section, format section,
 * bitrate section (with presets disabled above the source bitrate), output
 * file section, actions. State and behavior come from {@link useAudio};
 * this component is responsible only for presentation.
 */

import {
  RadioGroup,
  RadioGroupItem,
} from '@/shared/animate-ui/radix/radio-group'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import type { TFunction } from 'i18next'
import { FileUp, FolderOpen, Loader2, Music, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useAudio } from '../hooks/useAudio'
import { BITRATE_PRESETS, type BitratePreset } from '../lib/bitrate'
import { formatDuration } from '../lib/format'
import type { AudioFormat } from '../types'

export function AudioForm() {
  const { t } = useTranslation()
  const {
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
    setBitrateKbps,
    handleBrowse,
    handleChooseOutput,
    handleExtract,
    handleReveal,
    reset,
  } = useAudio()

  const isBusy = status === 'probing' || status === 'extracting'
  const isSuccess = status === 'success'
  const canExtract =
    Boolean(inputPath) && Boolean(outputPath) && !isBusy && !isSuccess

  return (
    <div className="flex flex-col gap-3">
      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">{t('audio.inputFile')}</h2>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleBrowse}
            disabled={isBusy}
          >
            <FileUp className="size-4" />
            {t('audio.browse')}
          </Button>
          {inputPath ? (
            <p
              className="text-muted-foreground min-w-0 flex-1 truncate text-sm"
              title={inputPath}
            >
              {inputPath}
            </p>
          ) : (
            <span className="text-muted-foreground text-sm">
              {t('audio.noFileSelected')}
            </span>
          )}
          {status === 'probing' && (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          )}
        </div>
        {inputBitrate !== null && (
          <p className="text-muted-foreground mt-2 text-xs">
            {t('audio.sourceBitrate', { value: inputBitrate })}
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">{t('audio.format.label')}</h2>
        <RadioGroup
          value={format}
          onValueChange={(v) => setFormat(v as AudioFormat)}
          className="grid grid-cols-2 gap-3"
          disabled={isBusy}
        >
          <label
            htmlFor="audio-format-mp3"
            className="flex cursor-pointer items-center gap-3"
          >
            <RadioGroupItem id="audio-format-mp3" value="mp3" />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">
                {t('audio.format.mp3')}
              </span>
              <span className="text-muted-foreground text-xs">
                {t('audio.format.mp3Hint')}
              </span>
            </div>
          </label>
          <label
            htmlFor="audio-format-m4a"
            className="flex cursor-pointer items-center gap-3"
          >
            <RadioGroupItem id="audio-format-m4a" value="m4a" />
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">
                {t('audio.format.m4a')}
              </span>
              <span className="text-muted-foreground text-xs">
                {t('audio.format.m4aHint')}
              </span>
            </div>
          </label>
        </RadioGroup>
      </section>

      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">{t('audio.bitrate.label')}</h2>
        <TooltipProvider>
          <RadioGroup
            value={String(bitrateKbps)}
            onValueChange={(v) => setBitrateKbps(Number(v))}
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
            disabled={isBusy}
          >
            {BITRATE_PRESETS.map((preset) => (
              <BitrateOption
                key={preset}
                preset={preset}
                isEnabled={enabledBitrates.includes(preset)}
                inputBitrate={inputBitrate}
                t={t}
              />
            ))}
          </RadioGroup>
        </TooltipProvider>
        <p className="text-muted-foreground mt-2 text-xs">
          {t('audio.bitrate.hint')}
        </p>
      </section>

      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">{t('audio.outputFile')}</h2>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleChooseOutput}
            disabled={!inputPath || isBusy}
          >
            <FolderOpen className="size-4" />
            {t('audio.chooseOutput')}
          </Button>
          {outputPath ? (
            <p
              className="text-muted-foreground min-w-0 flex-1 truncate text-sm"
              title={outputPath}
            >
              {outputPath}
            </p>
          ) : (
            <span className="text-muted-foreground text-sm">
              {t('audio.noOutputSelected')}
            </span>
          )}
        </div>
      </section>

      <div className="flex items-center gap-3">
        {(isBusy || isSuccess) && progress && (
          <>
            <div className="bg-primary/20 relative h-2 flex-1 overflow-hidden rounded-full">
              <div
                className="bg-primary h-full transition-[width] duration-1000 ease-linear"
                style={{ width: `${progress.progress}%` }}
              />
            </div>
            <span className="text-sm font-medium whitespace-nowrap tabular-nums">
              {Math.round(progress.progress)}%
            </span>
            <span className="text-muted-foreground text-sm whitespace-nowrap tabular-nums">
              {t('audio.elapsed')} {formatDuration(elapsedSec)}
              {remainingSec !== null && (
                <>
                  {' / '}
                  {t('audio.remaining')} {formatDuration(remainingSec)}
                </>
              )}
            </span>
          </>
        )}
        <div className="ml-auto flex gap-3">
          <Button
            variant="outline"
            onClick={handleReveal}
            disabled={!isSuccess || !outputPath}
            className={isSuccess && outputPath ? '' : 'invisible'}
          >
            <FolderOpen className="size-4" />
            {t('audio.openFolder')}
          </Button>
          <Button variant="ghost" onClick={reset} disabled={isBusy}>
            <RotateCcw className="size-4" />
            {t('audio.clear')}
          </Button>
          <Button onClick={handleExtract} disabled={!canExtract}>
            {status === 'extracting' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Music className="size-4" />
            )}
            {status === 'extracting'
              ? t('audio.extracting')
              : t('audio.extract')}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * A single bitrate preset radio option.
 *
 * When disabled (preset exceeds the source bitrate), wraps the label in a
 * tooltip so the user understands _why_ the option is unavailable. The
 * wrapper `<span>` receives the hover because the disabled control itself
 * has `pointer-events: none`.
 */
function BitrateOption({
  preset,
  isEnabled,
  inputBitrate,
  t,
}: {
  preset: BitratePreset
  isEnabled: boolean
  inputBitrate: number | null
  t: TFunction
}) {
  const label = (
    <label
      htmlFor={`audio-bitrate-${preset}`}
      className={cn(
        'flex items-center gap-2',
        isEnabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
      )}
    >
      <RadioGroupItem
        id={`audio-bitrate-${preset}`}
        value={String(preset)}
        disabled={!isEnabled}
      />
      <span className="text-sm font-medium">{preset} kbps</span>
    </label>
  )

  // No tooltip when enabled, or when the source bitrate is unknown.
  if (isEnabled || inputBitrate === null) return label

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{label}</span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="max-w-xs">
          {t('audio.bitrate.exceedsSource', { value: inputBitrate })}
        </p>
      </TooltipContent>
    </Tooltip>
  )
}

export default AudioForm
