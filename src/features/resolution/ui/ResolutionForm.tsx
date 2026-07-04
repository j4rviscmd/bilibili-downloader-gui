/**
 * Resolution conversion form UI.
 *
 * Layout follows the audio page pattern: input file section, resolution
 * section (with preset height values disabled above the source resolution,
 * plus a custom-height option), output file section, actions. State and
 * behavior come from {@link useResolution}; this component is responsible
 * only for presentation.
 */

import {
  RadioGroup,
  RadioGroupItem,
} from '@/shared/animate-ui/radix/radio-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import type { TFunction } from 'i18next'
import { FileUp, FolderOpen, Loader2, RotateCcw, Scaling } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useResolution } from '../hooks/useResolution'
import { formatDuration } from '../lib/format'
import { RESOLUTION_HEIGHT_PRESETS } from '../lib/resolution'

export function ResolutionForm() {
  const { t } = useTranslation()
  const {
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
  } = useResolution()

  const isBusy = status === 'probing' || status === 'converting'
  const isSuccess = status === 'success'
  const canConvert =
    Boolean(inputPath) && Boolean(outputPath) && !isBusy && !isSuccess

  return (
    <div className="flex flex-col gap-3">
      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">
          {t('resolution.inputFile')}
        </h2>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleBrowse}
            disabled={isBusy}
          >
            <FileUp className="size-4" />
            {t('resolution.browse')}
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
              {t('resolution.noFileSelected')}
            </span>
          )}
          {status === 'probing' && (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          )}
        </div>
        {inputResolution !== null && (
          <p className="text-muted-foreground mt-2 text-xs">
            {t('resolution.sourceResolution', {
              width: inputResolution.width,
              height: inputResolution.height,
            })}
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">
          {t('resolution.resolution.label')}
        </h2>
        <RadioGroup
          value={isCustomHeight ? 'custom' : String(targetHeight)}
          onValueChange={(v) => {
            if (v === 'custom') {
              setIsCustomHeight(true)
            } else {
              setIsCustomHeight(false)
              setTargetHeight(Number(v))
            }
          }}
          className="grid grid-cols-2 gap-3 sm:grid-cols-5"
          disabled={isBusy}
        >
          {RESOLUTION_HEIGHT_PRESETS.map((height) => (
            <ResolutionOption
              key={height}
              height={height}
              isEnabled={enabledResolutions.includes(height)}
              isDimmed={isCustomHeight}
              inputResolution={inputResolution}
              t={t}
            />
          ))}
          <label
            htmlFor="resolution-height-custom"
            className={cn(
              'flex items-center gap-3',
              isCustomHeight ? 'cursor-pointer' : 'cursor-pointer opacity-50',
            )}
          >
            <RadioGroupItem id="resolution-height-custom" value="custom" />
            <span className="text-sm font-medium">
              {t('resolution.resolution.custom')}
            </span>
          </label>
        </RadioGroup>
        {isCustomHeight && (
          <div className="mt-3 flex items-center gap-3">
            <label
              htmlFor="custom-height-input"
              className="text-sm font-medium"
            >
              {t('resolution.resolution.customHeightLabel')}
            </label>
            <Input
              id="custom-height-input"
              type="number"
              min="120"
              max="4320"
              step="2"
              value={targetHeight}
              onChange={(e) => setTargetHeight(Number(e.target.value))}
              disabled={isBusy}
              className="w-24"
            />
            <span className="text-muted-foreground text-sm">px</span>
          </div>
        )}
        <p className="text-muted-foreground mt-2 text-xs">
          {t('resolution.resolution.hint')}
        </p>
      </section>

      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">
          {t('resolution.outputFile')}
        </h2>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleChooseOutput}
            disabled={!inputPath || isBusy}
          >
            <FolderOpen className="size-4" />
            {t('resolution.chooseOutput')}
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
              {t('resolution.noOutputSelected')}
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
              {t('resolution.elapsed')} {formatDuration(elapsedSec)}
              {remainingSec !== null && (
                <>
                  {' / '}
                  {t('resolution.remaining')} {formatDuration(remainingSec)}
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
            {t('resolution.openFolder')}
          </Button>
          <Button variant="ghost" onClick={reset} disabled={isBusy}>
            <RotateCcw className="size-4" />
            {t('resolution.clear')}
          </Button>
          <Button onClick={handleConvert} disabled={!canConvert}>
            {status === 'converting' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Scaling className="size-4" />
            )}
            {status === 'converting'
              ? t('resolution.converting')
              : t('resolution.convert')}
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * A single resolution preset radio option.
 *
 * When disabled (preset would up-scale the source), wraps the label in a
 * tooltip so the user understands _why_ the option is unavailable. The
 * wrapper `<span>` receives the hover because the disabled control itself
 * has `pointer-events: none`.
 */
function ResolutionOption({
  height,
  isEnabled,
  isDimmed,
  inputResolution,
  t,
}: {
  height: number
  isEnabled: boolean
  /** Extra dim when a sibling custom option is the active selection. */
  isDimmed: boolean
  inputResolution: { width: number; height: number } | null
  t: TFunction
}) {
  const label = (
    <label
      htmlFor={`resolution-height-${height}`}
      className={cn(
        'flex items-center gap-3',
        isEnabled && !isDimmed
          ? 'cursor-pointer'
          : 'cursor-not-allowed opacity-50',
      )}
    >
      <RadioGroupItem
        id={`resolution-height-${height}`}
        value={String(height)}
        disabled={!isEnabled}
      />
      <span className="text-sm font-medium">{height}p</span>
    </label>
  )

  // No tooltip when enabled, or when the source resolution is unknown.
  if (isEnabled || inputResolution === null) return label

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{label}</span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="max-w-xs">
          {t('resolution.resolution.exceedsSource', {
            height: inputResolution.height,
          })}
        </p>
      </TooltipContent>
    </Tooltip>
  )
}

export default ResolutionForm
