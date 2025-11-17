import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/animate-ui/radix/dialog'
import CircleIndicator from '@/components/lib/CircleIndicator'
import ProgressStatusBar from '@/components/lib/Progress'
import { Button } from '@/components/ui/button'
import { useVideoInfo } from '@/features/video/useVideoInfo'
import { Download, Music, Play, Video } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const getBarInfo = (id: string, t: (k: string) => string) => {
  let label = ''
  let icon = <></>
  if (id === 'temp_audio') {
    label = t('video.bar_audio')
    icon = <Music size={13} />
  } else if (id === 'temp_video') {
    label = t('video.bar_video')
    icon = <Video size={13} />
  } else {
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
          progress.map((p) => {
            const barInfo = getBarInfo(p.downloadId, t)
            const barLabel = barInfo[0]
            const barIcon = barInfo[1]
            return (
              <div
                key={p.downloadId}
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
