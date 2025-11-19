import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/animate-ui/radix/dialog'
import CircleIndicator from '@/components/lib/CircleIndicator'
import ProgressStatusBar, { type Progress } from '@/components/lib/Progress'
import { Button } from '@/components/ui/button'
import { useVideoInfo } from '@/features/video/useVideoInfo'
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

  const phaseOrder = ['audio', 'video', 'merge']
  // active stages limited to audio/video/merge (exclude complete)
  const activeStages = progress.filter((p) =>
    ['audio', 'video', 'merge'].includes(p.stage || ''),
  )
  const isDownloading = activeStages.some((p) => !p.isComplete)

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
        </div>

        <div>
          <Button disabled={isDownloading} onClick={onClick}>
            {isDownloading ? (
              <CircleIndicator r={8} />
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
