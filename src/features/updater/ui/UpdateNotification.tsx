import { useAppDispatch, useSelector } from '@/app/store'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  setDownloadProgress,
  setError,
  setIsDownloading,
  setIsUpdateReady,
  setShowDialog,
} from '@/features/updater/model/updaterSlice'
import { relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import { Download, RefreshCw, X } from 'lucide-react'
import React, { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Update notification dialog component.
 *
 * Displays a notification when an update is available, shows release notes,
 * handles download progress, and provides update/cancel actions.
 */
export const UpdateNotification = React.memo(() => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const updater = useSelector((state) => state.updater)

  const handleUpdate = useCallback(async () => {
    try {
      dispatch(setIsDownloading(true))
      dispatch(setError(null))
      dispatch(setDownloadProgress(0))

      const update = await check()
      if (!update) {
        console.error('[Updater] No update available when trying to download')
        dispatch(setError(t('updater.error.no_update_available')))
        dispatch(setIsDownloading(false))
        return
      }

      let contentLength = 0
      let downloaded = 0

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 0
            dispatch(setDownloadProgress(0))
            break
          case 'Progress':
            downloaded += event.data.chunkLength
            dispatch(
              setDownloadProgress(
                Math.min(100, (downloaded / contentLength) * 100),
              ),
            )
            break
          case 'Finished':
            dispatch(setDownloadProgress(100))
            dispatch(setIsUpdateReady(true))
            dispatch(setIsDownloading(false))
            break
        }
      })

      dispatch(setIsDownloading(false))
      dispatch(setIsUpdateReady(true))
    } catch (e) {
      console.error('[Updater] Update failed:', e)
      dispatch(setError(t('updater.error.download_failed')))
      dispatch(setIsDownloading(false))
      dispatch(setDownloadProgress(0))
    }
  }, [dispatch, t])

  const handleCancel = useCallback(() => {
    dispatch(setShowDialog(false))
  }, [dispatch])

  const handleRetry = useCallback(() => {
    dispatch(setError(null))
    handleUpdate()
  }, [dispatch, handleUpdate])

  const handleRestart = useCallback(async () => {
    try {
      await relaunch()
    } catch (e) {
      console.error('[Updater] Restart failed:', e)
      dispatch(setError(t('updater.error.restart_failed')))
    }
  }, [dispatch, t])

  const markdownComponents = {
    h1: ({ children }: { children: React.ReactNode }) => (
      <h1 className="mb-4 text-xl font-bold">{children}</h1>
    ),
    h2: ({ children }: { children: React.ReactNode }) => (
      <h2 className="mt-4 mb-3 text-lg font-semibold">{children}</h2>
    ),
    h3: ({ children }: { children: React.ReactNode }) => (
      <h3 className="mt-3 mb-2 text-base font-medium">{children}</h3>
    ),
    p: ({ children }: { children: React.ReactNode }) => (
      <p className="mb-2 leading-relaxed">{children}</p>
    ),
    ul: ({ children }: { children: React.ReactNode }) => (
      <ul className="mb-3 list-inside list-disc space-y-1">{children}</ul>
    ),
    ol: ({ children }: { children: React.ReactNode }) => (
      <ol className="mb-3 list-inside list-decimal space-y-1">{children}</ol>
    ),
    li: ({ children }: { children: React.ReactNode }) => (
      <li className="ml-4">{children}</li>
    ),
    code: ({ children }: { children: React.ReactNode }) => (
      <code className="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">
        {children}
      </code>
    ),
    pre: ({ children }: { children: React.ReactNode }) => (
      <pre className="bg-muted mb-3 overflow-x-auto rounded-md p-3">
        {children}
      </pre>
    ),
    a: ({ href, children }: { href?: string; children: React.ReactNode }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:text-primary/80 underline"
      >
        {children}
      </a>
    ),
    strong: ({ children }: { children: React.ReactNode }) => (
      <strong className="font-semibold">{children}</strong>
    ),
    blockquote: ({ children }: { children: React.ReactNode }) => (
      <blockquote className="border-muted-foreground/20 my-3 border-l-4 pl-4 italic">
        {children}
      </blockquote>
    ),
  }

  return (
    <AlertDialog
      open={updater.showDialog}
      onOpenChange={(open) => !open && dispatch(setShowDialog(false))}
    >
      <AlertDialogContent
        size="lg"
        className="flex max-h-[90vh] w-[1200px] max-w-none flex-col"
      >
        <AlertDialogHeader className="place-items-start text-left">
          <AlertDialogTitle>
            {t('updater.title', { version: `v${updater.latestVersion}` })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="flex flex-wrap items-center gap-2">
              <span>{t('updater.description')}</span>
              <span className="text-muted-foreground">
                {t('updater.current_label')}
              </span>
              <Badge variant="secondary">v{updater.currentVersion}</Badge>
              <span className="text-muted-foreground">→</span>
              <span className="text-muted-foreground">
                {t('updater.latest_label')}
              </span>
              <Badge variant="default">v{updater.latestVersion}</Badge>
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="my-4 flex min-h-0 flex-1 flex-col">
          {updater.isDownloading ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t('updater.downloading')}
                </span>
                <span className="font-medium">
                  {Math.round(updater.downloadProgress)}%
                </span>
              </div>
              <Progress value={updater.downloadProgress} />
            </div>
          ) : updater.isUpdateReady ? (
            <div className="rounded-md bg-green-50 p-4 dark:bg-green-950">
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                {t('updater.ready')}
              </p>
              <p className="mt-1 text-xs text-green-700 dark:text-green-300">
                {t('updater.ready_description')}
              </p>
            </div>
          ) : updater.error ? (
            <div className="bg-destructive/10 rounded-md p-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <X className="text-destructive size-5" />
                </div>
                <div className="flex-1">
                  <p className="text-destructive text-sm font-medium">
                    {t('updater.error.title')}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {updater.error}
                  </p>
                </div>
              </div>
            </div>
          ) : updater.releaseNotes ? (
            <div className="border-border flex min-h-0 flex-1 flex-col rounded-md border">
              <div className="overflow-y-auto p-4">
                <div className="markdown-body text-sm">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {updater.releaseNotes}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="text-muted-foreground size-6 animate-spin" />
            </div>
          )}
        </div>

        <AlertDialogFooter>
          {updater.isUpdateReady ? (
            <>
              <AlertDialogCancel onClick={handleCancel}>
                {t('updater.actions.later')}
              </AlertDialogCancel>
              <Button onClick={handleRestart}>
                <RefreshCw className="mr-2 size-4" />
                {t('updater.actions.restart')}
              </Button>
            </>
          ) : updater.error ? (
            <>
              <AlertDialogCancel onClick={handleCancel}>
                {t('updater.actions.cancel')}
              </AlertDialogCancel>
              <Button onClick={handleRetry} variant="default">
                <RefreshCw className="mr-2 size-4" />
                {t('updater.actions.retry')}
              </Button>
            </>
          ) : (
            <>
              <AlertDialogCancel
                onClick={handleCancel}
                disabled={updater.isDownloading}
              >
                {t('updater.actions.later')}
              </AlertDialogCancel>
              <Button onClick={handleUpdate} disabled={updater.isDownloading}>
                {updater.isDownloading ? (
                  <>
                    <RefreshCw className="mr-2 size-4 animate-spin" />
                    {t('updater.actions.downloading')}
                  </>
                ) : (
                  <>
                    <Download className="mr-2 size-4" />
                    {t('updater.actions.update_now')}
                  </>
                )}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
})

UpdateNotification.displayName = 'UpdateNotification'
