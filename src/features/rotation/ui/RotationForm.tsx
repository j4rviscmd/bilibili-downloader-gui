/**
 * Rotation form UI.
 *
 * Layout follows the approved "vertical block" mock: input file section,
 * angle selection section, mode section (with per-option tooltip warnings),
 * output file section, actions. State and behavior come from {@link useRotation};
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
import { Button } from '@/shared/ui/button'
import {
  FileUp,
  FolderOpen,
  Info,
  Loader2,
  RefreshCw,
  RotateCw,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useRotation } from '../hooks/useRotation'
import { formatDuration } from '../lib/format'
import type { RotationAngle, RotationMode } from '../types'

// Static config for the angle radio group. Hoisted outside the component so
// the array is not reallocated on every render.
const ANGLE_OPTIONS: ReadonlyArray<{
  value: RotationAngle
  labelKey: string
  hintKey: string
}> = [
  {
    value: 90,
    labelKey: 'rotation.angle.right90',
    hintKey: 'rotation.angle.right90Hint',
  },
  {
    value: 180,
    labelKey: 'rotation.angle.180',
    hintKey: 'rotation.angle.180Hint',
  },
  {
    value: 270,
    labelKey: 'rotation.angle.left90',
    hintKey: 'rotation.angle.left90Hint',
  },
]

export function RotationForm() {
  const { t } = useTranslation()
  const {
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
  } = useRotation()

  const isRotating = status === 'rotating'
  const isSuccess = status === 'success'
  const canRotate =
    Boolean(inputPath) && Boolean(outputPath) && !isRotating && !isSuccess

  return (
    <div className="flex flex-col gap-3">
      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">{t('rotation.inputFile')}</h2>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleBrowse}
            disabled={isRotating}
          >
            <FileUp className="size-4" />
            {t('rotation.browse')}
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
              {t('rotation.noFileSelected')}
            </span>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">
          {t('rotation.angle.label')}
        </h2>
        <RadioGroup
          value={angle.toString()}
          onValueChange={(v) => setAngle(Number(v) as RotationAngle)}
          className="grid grid-cols-3 gap-3"
          disabled={isRotating}
        >
          {ANGLE_OPTIONS.map(({ value, labelKey, hintKey }) => (
            <label
              key={value}
              htmlFor={`rotation-angle-${value}`}
              className="flex cursor-pointer items-start gap-3"
            >
              <RadioGroupItem
                id={`rotation-angle-${value}`}
                value={String(value)}
                className="mt-0.5"
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium whitespace-nowrap">
                  {t(labelKey)}
                </span>
                <span className="text-muted-foreground text-xs">
                  {t(hintKey)}
                </span>
              </div>
            </label>
          ))}
        </RadioGroup>
      </section>

      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">{t('rotation.mode.label')}</h2>
        <TooltipProvider>
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as RotationMode)}
            className="grid grid-cols-2 gap-3"
            disabled={isRotating}
          >
            <label
              htmlFor="rotation-mode-copy"
              className="flex cursor-pointer items-start gap-3"
            >
              <RadioGroupItem
                id="rotation-mode-copy"
                value="copy"
                className="mt-0.5"
              />
              <div className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1 text-sm font-medium whitespace-nowrap">
                  {t('rotation.mode.fast')}
                  <span className="bg-primary/10 text-primary rounded px-1 py-0.5 text-[10px] leading-none font-semibold">
                    {t('rotation.mode.fastBadge')}
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.preventDefault()}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={t('rotation.warningMetadata')}
                      >
                        <Info className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">
                        {t('rotation.warningMetadata')}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </span>
                <span className="text-muted-foreground text-xs">
                  {t('rotation.mode.fastHint')}
                </span>
              </div>
            </label>
            <label
              htmlFor="rotation-mode-reencode"
              className="flex cursor-pointer items-start gap-3"
            >
              <RadioGroupItem
                id="rotation-mode-reencode"
                value="reencode"
                className="mt-0.5"
              />
              <div className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1 text-sm font-medium whitespace-nowrap">
                  {t('rotation.mode.accurate')}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.preventDefault()}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={t('rotation.warningReencode')}
                      >
                        <Info className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">
                        {t('rotation.warningReencode')}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </span>
                <span className="text-muted-foreground text-xs">
                  {t('rotation.mode.accurateHint')}
                </span>
              </div>
            </label>
          </RadioGroup>
        </TooltipProvider>
      </section>

      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">{t('rotation.outputFile')}</h2>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleChooseOutput}
            disabled={!inputPath || isRotating}
          >
            <FolderOpen className="size-4" />
            {t('rotation.chooseOutput')}
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
              {t('rotation.noOutputSelected')}
            </span>
          )}
        </div>
      </section>

      <div className="flex items-center gap-3">
        {/* Why: The progress bar is shown only for reencode mode. In copy mode
            ffmpeg finishes near-instantly so there is no meaningful progress
            to display; the rotate button's spinner (Loader2) is the sole
            indicator (see RotationProgressPayload CAUTION in rotation.rs). */}
        {mode === 'reencode' && (isRotating || isSuccess) && progress && (
          <>
            <div className="bg-primary/20 relative h-2 flex-1 overflow-hidden rounded-full">
              {/* Constraint: duration-1000 mirrors ffmpeg's -stats_period 1
                  (build_ffmpeg_args in rotation.rs). Progress emits every 1s;
                  this 1s linear transition interpolates between emits so the
                  bar moves continuously instead of jumping per update. */}
              <div
                className="bg-primary h-full transition-[width] duration-1000 ease-linear"
                style={{ width: `${progress.progress}%` }}
              />
            </div>
            <span className="text-sm font-medium whitespace-nowrap tabular-nums">
              {Math.round(progress.progress)}%
            </span>
            <span className="text-muted-foreground text-sm whitespace-nowrap tabular-nums">
              {t('rotation.elapsed')} {formatDuration(elapsedSec)}
              {remainingSec !== null && (
                <>
                  {' / '}
                  {t('rotation.remaining')} {formatDuration(remainingSec)}
                </>
              )}
            </span>
          </>
        )}
        <div className="ml-auto flex gap-3">
          {/* Why: 'invisible' (not a conditional render) keeps the button's
              layout slot so the Clear/Rotate buttons don't shift position,
              while hiding a greyed-out disabled reveal button that would
              otherwise appear before any rotation has completed. */}
          <Button
            variant="outline"
            onClick={handleReveal}
            disabled={!isSuccess || !outputPath}
            className={isSuccess && outputPath ? '' : 'invisible'}
          >
            <FolderOpen className="size-4" />
            {t('rotation.openFolder')}
          </Button>
          <Button variant="ghost" onClick={reset} disabled={isRotating}>
            <RotateCw className="size-4" />
            {t('rotation.clear')}
          </Button>
          <Button onClick={handleRotate} disabled={!canRotate}>
            {isRotating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {isRotating ? t('rotation.rotating') : t('rotation.rotate')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default RotationForm
