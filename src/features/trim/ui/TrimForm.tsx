/**
 * Trim form UI.
 *
 * Layout follows the approved "vertical block" mock: input file section,
 * trim range section, output file section, mode section (with per-option
 * tooltip warnings), actions. State and behavior come from {@link useTrim};
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
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import {
  FileUp,
  FolderOpen,
  Info,
  Loader2,
  RotateCcw,
  Scissors,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useTrim } from '../hooks/useTrim'
import { formatDuration } from '../lib/format'
import type { TrimMode } from '../types'

export function TrimForm() {
  const { t } = useTranslation()
  const {
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
  } = useTrim()

  const isTrimming = status === 'trimming'
  const isSuccess = status === 'success'
  const canTrim =
    Boolean(inputPath) && Boolean(outputPath) && !isTrimming && !isSuccess
  const rangeErrorKey = rangeError ? `trim.error.${rangeError}` : null

  return (
    <div className="flex flex-col gap-3">
      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">{t('trim.inputFile')}</h2>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleBrowse}
            disabled={isTrimming}
          >
            <FileUp className="size-4" />
            {t('trim.browse')}
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
              {t('trim.noFileSelected')}
            </span>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">{t('trim.trimRange')}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="trim-start">{t('trim.startTime')}</Label>
            <Input
              id="trim-start"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              placeholder={t('trim.timePlaceholder')}
              disabled={isTrimming}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="trim-end">{t('trim.endTime')}</Label>
            <Input
              id="trim-end"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              placeholder={t('trim.timePlaceholder')}
              disabled={isTrimming}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>
        {rangeErrorKey && (
          <p className="text-destructive mt-2 text-sm">{t(rangeErrorKey)}</p>
        )}
        <p className="text-muted-foreground mt-2 text-xs">
          {t('trim.rangeHint')}
        </p>
      </section>

      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">{t('trim.outputFile')}</h2>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleChooseOutput}
            disabled={!inputPath || isTrimming}
          >
            <FolderOpen className="size-4" />
            {t('trim.chooseOutput')}
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
              {t('trim.noOutputSelected')}
            </span>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">{t('trim.mode.label')}</h2>
        <TooltipProvider>
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as TrimMode)}
            className="grid grid-cols-2 gap-3"
            disabled={isTrimming}
          >
            <label
              htmlFor="trim-mode-copy"
              className="flex cursor-pointer items-start gap-3"
            >
              <RadioGroupItem
                id="trim-mode-copy"
                value="copy"
                className="mt-0.5"
              />
              <div className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1 text-sm font-medium whitespace-nowrap">
                  {t('trim.mode.fast')}
                  <span className="bg-primary/10 text-primary rounded px-1 py-0.5 text-[10px] leading-none font-semibold">
                    {t('trim.mode.fastBadge')}
                  </span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.preventDefault()}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={t('trim.warningKeyframe')}
                      >
                        <Info className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">{t('trim.warningKeyframe')}</p>
                    </TooltipContent>
                  </Tooltip>
                </span>
                <span className="text-muted-foreground text-xs">
                  {t('trim.mode.fastHint')}
                </span>
              </div>
            </label>
            <label
              htmlFor="trim-mode-reencode"
              className="flex cursor-pointer items-start gap-3"
            >
              <RadioGroupItem
                id="trim-mode-reencode"
                value="reencode"
                className="mt-0.5"
              />
              <div className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1 text-sm font-medium whitespace-nowrap">
                  {t('trim.mode.accurate')}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.preventDefault()}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={t('trim.warningReencode')}
                      >
                        <Info className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="max-w-xs">{t('trim.warningReencode')}</p>
                    </TooltipContent>
                  </Tooltip>
                </span>
                <span className="text-muted-foreground text-xs">
                  {t('trim.mode.accurateHint')}
                </span>
              </div>
            </label>
          </RadioGroup>
        </TooltipProvider>
      </section>

      <div className="flex items-center gap-3">
        {(isTrimming || isSuccess) && progress && (
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
              {t('trim.elapsed')} {formatDuration(elapsedSec)}
              {remainingSec !== null && (
                <>
                  {' / '}
                  {t('trim.remaining')} {formatDuration(remainingSec)}
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
            {t('trim.openFolder')}
          </Button>
          <Button variant="ghost" onClick={reset} disabled={isTrimming}>
            <RotateCcw className="size-4" />
            {t('trim.clear')}
          </Button>
          <Button onClick={handleTrim} disabled={!canTrim}>
            {isTrimming ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Scissors className="size-4" />
            )}
            {isTrimming ? t('trim.trimming') : t('trim.trim')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default TrimForm
