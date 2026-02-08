import {
  setError,
  setDownloadProgress,
  setIsDownloading,
  setIsUpdateReady,
  setShowDialog,
} from '@/features/updater/model/updaterSlice'
import { useAppDispatch, useSelector } from '@/app/store'
import { Download, RefreshCw, X } from 'lucide-react'
import React, { useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

/**
 * Update notification dialog component.
 *
 * Displays a notification when an update is available, shows release notes,
 * handles download progress, and provides update/cancel actions.
 */
export const UpdateNotification = React.memo(() => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const latestVersion = useSelector((state) => state.updater.latestVersion)
  const currentVersion = useSelector((state) => state.updater.currentVersion)
  const releaseNotes = useSelector((state) => state.updater.releaseNotes)
  const downloadProgress = useSelector((state) => state.updater.downloadProgress)
  const isDownloading = useSelector((state) => state.updater.isDownloading)
  const isUpdateReady = useSelector((state) => state.updater.isUpdateReady)
  const error = useSelector((state) => state.updater.error)
  const showDialog = useSelector((state) => state.updater.showDialog)

  /**
   * Handles the update download and installation process.
   */
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

      // Download with progress tracking
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
            const progress = Math.min(
              100,
              (downloaded / contentLength) * 100,
            )
            dispatch(setDownloadProgress(progress))
            break
          case 'Finished':
            dispatch(setDownloadProgress(100))
            dispatch(setIsUpdateReady(true))
            dispatch(setIsDownloading(false))
            break
        }
      })

      // Update ready - restart the app
      dispatch(setIsDownloading(false))
      dispatch(setIsUpdateReady(true))
    } catch (e) {
      console.error('[Updater] Update failed:', e)
      dispatch(setError(t('updater.error.download_failed')))
      dispatch(setIsDownloading(false))
      dispatch(setDownloadProgress(0))
    }
  }, [dispatch, t])

  /**
   * Handles closing the dialog without updating.
   */
  const handleCancel = useCallback(() => {
    dispatch(setShowDialog(false))
  }, [dispatch])

  /**
   * Handles retrying the update after an error.
   */
  const handleRetry = useCallback(() => {
    dispatch(setError(null))
    handleUpdate()
  }, [dispatch, handleUpdate])

  /**
   * Handles restarting the app after update is ready.
   */
  const handleRestart = useCallback(async () => {
    try {
      await relaunch()
    } catch (e) {
      console.error('[Updater] Restart failed:', e)
      dispatch(setError(t('updater.error.restart_failed')))
    }
  }, [dispatch, t])

  return (
    <AlertDialog open={showDialog} onOpenChange={(open) => !open && dispatch(setShowDialog(false))}>
      <AlertDialogContent size="lg" className="w-[1200px] max-w-none max-h-[90vh] flex flex-col">
        <AlertDialogHeader className="place-items-start text-left">
          <AlertDialogTitle>
            {t('updater.title', { version: `v${latestVersion}` })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="flex flex-wrap items-center gap-2">
              <span>{t('updater.description')}</span>
              <span className="text-muted-foreground">{t('updater.current_label')}</span>
              <Badge variant="secondary">v{currentVersion}</Badge>
              <span className="text-muted-foreground">→</span>
              <span className="text-muted-foreground">{t('updater.latest_label')}</span>
              <Badge variant="default">v{latestVersion}</Badge>
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="my-4 flex-1 min-h-0 flex flex-col">
          {isDownloading ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t('updater.downloading')}
                </span>
                <span className="font-medium">{Math.round(downloadProgress)}%</span>
              </div>
              <Progress value={downloadProgress} />
            </div>
          ) : isUpdateReady ? (
            <div className="rounded-md bg-green-50 p-4 dark:bg-green-950">
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                {t('updater.ready')}
              </p>
              <p className="mt-1 text-xs text-green-700 dark:text-green-300">
                {t('updater.ready_description')}
              </p>
            </div>
          ) : error ? (
            <div className="rounded-md bg-destructive/10 p-4">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <X className="size-5 text-destructive" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-destructive">
                    {t('updater.error.title')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {error}
                  </p>
                </div>
              </div>
            </div>
          ) : releaseNotes ? (
            <div className="rounded-md border border-border flex-1 min-h-0 flex flex-col">
              <div className="p-4 overflow-y-auto">
                <div className="markdown-body text-sm">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => (
                      <h1 className="text-xl font-bold mb-4">{children}</h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="text-lg font-semibold mb-3 mt-4">{children}</h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="text-base font-medium mb-2 mt-3">{children}</h3>
                    ),
                    p: ({ children }) => (
                      <p className="mb-2 leading-relaxed">{children}</p>
                    ),
                    ul: ({ children }) => (
                      <ul className="list-disc list-inside mb-3 space-y-1">{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="list-decimal list-inside mb-3 space-y-1">{children}</ol>
                    ),
                    li: ({ children }) => (
                      <li className="ml-4">{children}</li>
                    ),
                    code: ({ children }) => (
                      <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>
                    ),
                    pre: ({ children }) => (
                      <pre className="bg-muted p-3 rounded-md overflow-x-auto mb-3">{children}</pre>
                    ),
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80">{children}</a>
                    ),
                    strong: ({ children }) => (
                      <strong className="font-semibold">{children}</strong>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-4 border-muted-foreground/20 pl-4 italic my-3">{children}</blockquote>
                    ),
                  }}
                >
                  {releaseNotes}
                </ReactMarkdown>
              </div>
            </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="size-6 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

        <AlertDialogFooter>
          {isUpdateReady ? (
            <>
              <AlertDialogCancel onClick={handleCancel}>
                {t('updater.actions.later')}
              </AlertDialogCancel>
              <Button onClick={handleRestart}>
                <RefreshCw className="mr-2 size-4" />
                {t('updater.actions.restart')}
              </Button>
            </>
          ) : error ? (
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
                disabled={isDownloading}
              >
                {t('updater.actions.later')}
              </AlertDialogCancel>
              <Button onClick={handleUpdate} disabled={isDownloading}>
                {isDownloading ? (
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
