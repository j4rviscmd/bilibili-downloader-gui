/**
 * GIF/WebM generator form UI.
 *
 * Layout mirrors TrimForm: input file section, clip range section, output
 * file section, format/size section, actions. State and behavior come from
 * {@link useGif}; this component is responsible only for presentation.
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
  ImagePlay,
  Info,
  Loader2,
  RotateCcw,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useGif } from '../hooks/useGif'
import { formatDuration } from '../lib/format'
import type { GifFormat, GifFpsPreset, GifWidthPreset } from '../types'

/** Width presets offered in the size section. Numeric presets are px. */
const WIDTH_PRESETS: GifWidthPreset[] = ['original', '640', '480', '320']
/** FPS presets offered in the size section. */
const FPS_PRESETS: GifFpsPreset[] = ['15', '10', '24']

export function GifForm() {
  const { t } = useTranslation()
  const {
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
  } = useGif()

  const isGenerating = status === 'generating'
  const isSuccess = status === 'success'
  const canGenerate =
    Boolean(inputPath) && Boolean(outputPath) && !isGenerating && !isSuccess
  const rangeErrorKey = rangeError ? `gif.error.${rangeError}` : null

  const widthLabel = (preset: GifWidthPreset) => {
    if (preset !== 'original') return `${preset}px`
    return sourceWidth !== null
      ? `${t('gif.size.original')} (${sourceWidth}px)`
      : t('gif.size.original')
  }

  return (
    <div className="flex flex-col gap-3">
      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">{t('gif.inputFile')}</h2>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleBrowse}
            disabled={isGenerating}
          >
            <FileUp className="size-4" />
            {t('gif.browse')}
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
              {t('gif.noFileSelected')}
            </span>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">{t('gif.clipRange')}</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="gif-start">{t('gif.startTime')}</Label>
            <Input
              id="gif-start"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              placeholder={t('gif.timePlaceholder')}
              disabled={isGenerating}
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="gif-end">{t('gif.endTime')}</Label>
            <Input
              id="gif-end"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              placeholder={t('gif.timePlaceholder')}
              disabled={isGenerating}
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
          {t('gif.rangeHint')}
        </p>
      </section>

      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">{t('gif.outputFile')}</h2>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleChooseOutput}
            disabled={!inputPath || isGenerating}
          >
            <FolderOpen className="size-4" />
            {t('gif.chooseOutput')}
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
              {t('gif.noOutputSelected')}
            </span>
          )}
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">{t('gif.format.label')}</h2>
        <div className="flex flex-col gap-4">
          <TooltipProvider>
            <RadioGroup
              value={format}
              onValueChange={(v) => setFormat(v as GifFormat)}
              className="grid grid-cols-2 gap-3"
              disabled={isGenerating}
            >
              <label
                htmlFor="gif-format-gif"
                className="flex cursor-pointer items-start gap-3"
              >
                <RadioGroupItem
                  id="gif-format-gif"
                  value="gif"
                  className="mt-0.5"
                />
                <div className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1 text-sm font-medium whitespace-nowrap">
                    {t('gif.format.gif')}
                    <span className="bg-primary/10 text-primary rounded px-1 py-0.5 text-[10px] leading-none font-semibold">
                      {t('gif.format.universalBadge')}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          // Why: the button lives inside the radio's <label>; HTML
                          // label default activation would also flip the radio on
                          // click, so preventDefault suppresses it (same guard as
                          // the info buttons in src/features/trim/ui/TrimForm.tsx)
                          onClick={(e) => e.preventDefault()}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={t('gif.format.gifHint')}
                        >
                          <Info className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">{t('gif.format.gifHint')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t('gif.format.gifHintShort')}
                  </span>
                </div>
              </label>
              <label
                htmlFor="gif-format-webm"
                className="flex cursor-pointer items-start gap-3"
              >
                <RadioGroupItem
                  id="gif-format-webm"
                  value="webm"
                  className="mt-0.5"
                />
                <div className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1 text-sm font-medium whitespace-nowrap">
                    {t('gif.format.webm')}
                    <span className="bg-primary/10 text-primary rounded px-1 py-0.5 text-[10px] leading-none font-semibold">
                      {t('gif.format.smallBadge')}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={(e) => e.preventDefault()}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={t('gif.format.webmHint')}
                        >
                          <Info className="size-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="max-w-xs">{t('gif.format.webmHint')}</p>
                      </TooltipContent>
                    </Tooltip>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t('gif.format.webmHintShort')}
                  </span>
                </div>
              </label>
            </RadioGroup>
          </TooltipProvider>

          <div className="flex flex-col gap-2">
            <Label>{t('gif.size.width')}</Label>
            <TooltipProvider>
              <RadioGroup
                value={widthPreset}
                onValueChange={(v) => setWidthPreset(v as GifWidthPreset)}
                className="flex flex-wrap gap-3"
                disabled={isGenerating}
              >
                {WIDTH_PRESETS.map((preset) => (
                  <label
                    key={preset}
                    htmlFor={`gif-width-${preset}`}
                    className="flex cursor-pointer items-center gap-1.5"
                  >
                    <RadioGroupItem
                      id={`gif-width-${preset}`}
                      value={preset}
                      className="size-4"
                    />
                    <span className="text-sm">{widthLabel(preset)}</span>
                  </label>
                ))}
              </RadioGroup>
            </TooltipProvider>
          </div>

          <div className="flex flex-col gap-2">
            <Label>{t('gif.size.fps')}</Label>
            <TooltipProvider>
              <RadioGroup
                value={fps}
                onValueChange={(v) => setFps(v as GifFpsPreset)}
                className="flex flex-wrap gap-3"
                disabled={isGenerating}
              >
                {FPS_PRESETS.map((preset) => (
                  <label
                    key={preset}
                    htmlFor={`gif-fps-${preset}`}
                    className="flex cursor-pointer items-center gap-1.5"
                  >
                    <RadioGroupItem
                      id={`gif-fps-${preset}`}
                      value={preset}
                      className="size-4"
                    />
                    <span className="text-sm">{preset} fps</span>
                  </label>
                ))}
              </RadioGroup>
            </TooltipProvider>
          </div>
        </div>
      </section>

      <div className="flex items-center gap-3">
        {(isGenerating || isSuccess) && progress && (
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
              {t('gif.elapsed')} {formatDuration(elapsedSec)}
              {remainingSec !== null && (
                <>
                  {' / '}
                  {t('gif.remaining')} {formatDuration(remainingSec)}
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
            // Why: `invisible` instead of conditional render keeps the hidden
            // button's box, so the Clear/Generate buttons to its right don't
            // shift when it appears (same layout trick as TrimForm)
            className={isSuccess && outputPath ? '' : 'invisible'}
          >
            <FolderOpen className="size-4" />
            {t('gif.openFolder')}
          </Button>
          <Button variant="ghost" onClick={reset} disabled={isGenerating}>
            <RotateCcw className="size-4" />
            {t('gif.clear')}
          </Button>
          <Button onClick={handleGenerate} disabled={!canGenerate}>
            {isGenerating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ImagePlay className="size-4" />
            )}
            {isGenerating ? t('gif.generating') : t('gif.generate')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default GifForm
