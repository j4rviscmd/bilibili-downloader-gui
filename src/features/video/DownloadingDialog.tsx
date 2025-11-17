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
  const { progress } = useVideoInfo()
  const { t } = useTranslation()
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
  const isDownloading =
    progress.length > 0 && !progress.every((p) => p.isComplete)

  return (
    <Dialog modal open={hasDlQue}>
      <DialogContent
        disableOutsideClick
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="flex flex-col items-center justify-center [&>button]:hidden"
      >
        <DialogHeader className="w-full">
          <DialogTitle className="text-primary flex w-full items-center">
            <Download size={16} className="mr-0.5" />
            <span>{t('video.progress_title')}</span>
          </DialogTitle>
          <DialogDescription hidden />
        </DialogHeader>
        {hasDlQue &&
          Object.entries(groups).map(([parentId, entries]) => {
            // sort entries by phase order and fallback to existing order
            const sorted = entries.sort((a, b) => {
              const ai = a.stage ? phaseOrder.indexOf(a.stage) : -1
              const bi = b.stage ? phaseOrder.indexOf(b.stage) : -1
              return ai - bi
            })
            return (
              <div key={parentId} className="mb-3 w-full">
                {sorted.map((p) => {
                  const barInfo = getBarInfo(p.downloadId, p.stage, t)
                  const barLabel = barInfo[0]
                  const barIcon = barInfo[1]
                  const key = p.internalId || `${p.downloadId}:${p.stage}`
                  if (!p.stage) return
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
                        <ProgressStatusBar progress={p} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
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
