import { useSelector, type RootState } from '@/app/store'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/animate-ui/radix/dialog'
import CircleIndicator from '@/shared/ui/CircleIndicator'
import ProgressStatusBar, { type Progress } from '@/shared/ui/Progress'
import { Button } from '@/shared/ui/button'
import { useVideoInfo } from '@/features/video/hooks/useVideoInfo'
import { Download, Music, Play, Video } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const getBarInfo = (
  id: string | undefined,
  stage: string | undefined,
  t: (k: string) => string,
) => {
  let label = ''
  let icon = <></>
  if (stage === 'audio' || id === 'temp_audio') {
    label = t('video.bar_audio')
    icon = <Music size={13} />
  } else if (stage === 'video' || id === 'temp_video') {
    label = t('video.bar_video')
    icon = <Video size={13} />
  } else if (stage === 'merge') {
    label = t('video.bar_merge')
    icon = <Play size={13} />
  }

  return [label, icon]
}

function DownloadingDialog() {
  const { progress, input, video } = useVideoInfo()
  const { t } = useTranslation()
  const deriveTitle = (p: Progress): string | undefined => {
    const m = p.downloadId.match(/-p(\d+)$/)
    if (m) {
      const idx = parseInt(m[1], 10) - 1
      return input.partInputs[idx]?.title
    }
    return video?.title
  }

  const onClick = () => {
    // Disabled: do not mutate localStorage on download completion
    // localStorage.setItem(VIDEO_URL_KEY, '')
    // NOTE: ページリロードによりリセットするのでコメントアウト
    // store.dispatch(clearProgress())
    // ページをリロードして状態をリセット
    window.location.reload()
  }
  const hasDlQue = progress.length > 0
  // group progress entries by parentId (downloadId)
  const groups = progress.reduce<Record<string, Progress[]>>((acc, p) => {
    const parent = p.parentId || p.downloadId
    if (!acc[parent]) acc[parent] = []
    acc[parent].push(p)
    return acc
  }, {})

  // groupsが現在ダイアログに表示中(=進行中)のキュー
  // input.partInputsを母集団とした時、groupsに含まれていないアイテムリストを取得する
  // 存在判定はdownloadIdの末尾 -p{page} で行う
  const activePages = new Set<number>()
  Object.values(groups).forEach((entries) => {
    entries.forEach((p) => {
      const m = p.downloadId.match(/-p(\d+)$/)
      if (m) {
        activePages.add(Number(m[1]))
      }
    })
  })
  // NOTE: DL進行中でないパートリスト
  const notInProgress = input.partInputs.filter(
    (part) => !activePages.has(part.page),
  )

  const phaseOrder = ['audio', 'video', 'merge']
  // active stages limited to audio/video/merge (exclude complete)
  const activeStages = progress.filter((p) =>
    ['audio', 'video', 'merge'].includes(p.stage || ''),
  )
  const { hasError, errorMessage } = useSelector(
    (s: RootState) => s.downloadStatus,
  )
  // エラー時は即ボタン活性化するため hasError 優先で isDownloading を false にする
  const isDownloading =
    !hasError &&
    (activeStages.some((p) => !p.isComplete) || notInProgress.length > 0)

  return (
    <Dialog modal open={hasDlQue}>
      <DialogContent
        disableOutsideClick
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="flex max-h-[80%] flex-col items-center justify-center [&>button]:hidden"
      >
        <DialogHeader className="w-full">
          <DialogTitle className="text-primary flex w-full items-center">
            <Download size={16} className="mr-0.5" />
            <span>{t('video.progress_title')}</span>
          </DialogTitle>
          <DialogDescription hidden />
        </DialogHeader>
        <div className="flex h-full w-full flex-col items-center overflow-auto">
          {hasDlQue &&
            Object.entries(groups).map(([parentId, entries]) => {
              // sort entries by phase order and fallback to existing order
              const sorted = entries.sort((a, b) => {
                const ai = a.stage ? phaseOrder.indexOf(a.stage) : -1
                const bi = b.stage ? phaseOrder.indexOf(b.stage) : -1
                return ai - bi
              })
              return (
                <div
                  key={parentId}
                  className="mb-3 w-full rounded-md border px-1 py-3"
                >
                  {(() => {
                    const first = sorted.find(
                      (p) => p.stage && p.stage !== 'complete',
                    )
                    const groupTitle = first
                      ? deriveTitle(first)
                      : video?.title || ''
                    return groupTitle ? (
                      <div
                        className="text-md mb-1 truncate px-3 font-semibold"
                        title={groupTitle}
                      >
                        {groupTitle}
                      </div>
                    ) : null
                  })()}
                  {sorted.map((p) => {
                    const barInfo = getBarInfo(p.downloadId, p.stage, t)
                    const barLabel = barInfo[0]
                    const barIcon = barInfo[1]
                    const key = p.internalId || `${p.downloadId}:${p.stage}`
                    if (!p.stage || p.stage === 'complete') return
                    return (
                      <div
                        key={key}
                        className="text-accent-foreground box-border w-full px-3"
                      >
                        <div className="flex items-center">
                          <span className="mr-1">{barIcon}</span>
                          <span>{barLabel}</span>
                        </div>
                        <div className="px-3">
                          {p.stage === 'merge' ? (
                            <div className="flex items-center justify-between text-sm">
                              <span>{t('video.bar_merge')}</span>
                              {!p.isComplete && <CircleIndicator r={8} />}
                              {p.isComplete && (
                                <span>{t('video.completed')}</span>
                              )}
                            </div>
                          ) : (
                            <ProgressStatusBar progress={p} />
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          {notInProgress.map((part) => (
            <div
              key={part.page}
              className="mb-3 w-full rounded-md border px-1 py-3"
            >
              <div
                className="text-md mb-1 truncate px-3 font-semibold"
                title={part.title}
              >
                <span className="pr-1">{t('video.queue_waiting_prefix')}</span>
                <span>{part.title}</span>
              </div>
            </div>
          ))}
        </div>

        {hasError && (
          <div
            role="alert"
            className="border-destructive/40 bg-destructive/10 text-destructive mb-4 w-full rounded-md border px-4 py-3 text-sm"
          >
            <div className="mb-1 font-semibold">
              {t('video.download_failed')}
            </div>
            <div className="truncate" title={errorMessage || ''}>
              {errorMessage}
            </div>
            <div className="text-muted-foreground mt-2 text-xs">
              {t('video.reload_after_error')}
            </div>
          </div>
        )}
        <div>
          <Button disabled={isDownloading} onClick={onClick}>
            {isDownloading ? (
              <CircleIndicator r={8} />
            ) : hasError ? (
              t('video.reload_after_error')
            ) : (
              t('video.download_completed')
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default DownloadingDialog
