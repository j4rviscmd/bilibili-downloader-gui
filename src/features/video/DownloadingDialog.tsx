import { store } from '@/app/store'
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
import { clearProgress } from '@/shared/progress/progressSlice'
import { Download, Music, Play, Video } from 'lucide-react'

const getBarInfo = (id: string) => {
  let label = ''
  let icon = <></>
  if (id === 'temp_audio') {
    label = '音声データ'
    icon = <Music size={13} />
  } else if (id === 'temp_video') {
    label = '動画データ'
    icon = <Video size={13} />
  } else {
    label = '動画の生成'
    icon = <Play size={13} />
  }

  return [label, icon]
}

function DownloadingDialog() {
  const { progress } = useVideoInfo()
  const onClick = () => {
    store.dispatch(clearProgress())
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
            <span>ダウンロード進行状況</span>
          </DialogTitle>
          <DialogDescription hidden />
        </DialogHeader>
        {hasDlQue &&
          progress.map((p) => {
            const barInfo = getBarInfo(p.downloadId)
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
            {isDownloading ? <CircleIndicator r={8} /> : 'ダウンロード完了'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default DownloadingDialog
