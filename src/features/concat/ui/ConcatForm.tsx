import { useConcat } from '../hooks/useConcat'
import { formatDuration } from '../lib/format'
import { FileList } from './FileList'

import { Button } from '@/shared/ui/button'
import { Combine, FolderOpen, Loader2, Plus, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Main form component for the video concatenation feature.
 *
 * Renders the file list (with drag-and-drop reordering), output path
 * selector, progress bar, and action buttons. Delegates all state
 * management to the {@link useConcat} hook.
 */
export function ConcatForm() {
  const { t } = useTranslation()
  const {
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
  } = useConcat()

  const isConcatting = status === 'concatting'
  const isSuccess = status === 'success'
  const canConcat =
    files.length >= 2 && Boolean(outputPath) && !isConcatting && !isSuccess
  const validationErrorKey = validationError
    ? `concat.error.${validationError}`
    : null

  return (
    <div className="flex flex-col gap-3">
      <section className="overflow-hidden rounded-lg border p-3">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">{t('concat.fileList')}</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={handleAddFiles}
            disabled={isConcatting}
          >
            <Plus className="size-4" />
            {t('concat.addFiles')}
          </Button>
        </div>
        {files.length > 0 ? (
          <>
            <FileList
              files={files}
              isProcessing={isConcatting}
              onRemove={handleRemoveFile}
              onReorder={handleReorderFiles}
            />
            <p className="text-muted-foreground mt-2 text-xs">
              {t('concat.dragToReorder')}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t('concat.noFilesSelected')}
          </p>
        )}
        {validationErrorKey && (
          <p className="text-destructive mt-2 text-sm">
            {t(validationErrorKey)}
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border p-3">
        <h2 className="mb-3 text-sm font-medium">{t('concat.outputFile')}</h2>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleChooseOutput}
            disabled={isConcatting}
          >
            <FolderOpen className="size-4" />
            {t('concat.chooseOutput')}
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
              {t('concat.noOutputSelected')}
            </span>
          )}
        </div>
      </section>

      <div className="flex items-center gap-3">
        {(isConcatting || isSuccess) && progress && (
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
              {t('concat.elapsed')} {formatDuration(elapsedSec)}
              {remainingSec !== null && (
                <>
                  {' / '}
                  {t('concat.remaining')} {formatDuration(remainingSec)}
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
            {t('concat.openFolder')}
          </Button>
          <Button variant="ghost" onClick={reset} disabled={isConcatting}>
            <RotateCcw className="size-4" />
            {t('concat.clear')}
          </Button>
          <Button onClick={handleConcat} disabled={!canConcat}>
            {isConcatting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Combine className="size-4" />
            )}
            {isConcatting ? t('concat.concatting') : t('concat.concat')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default ConcatForm
