import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/animate-ui/radix/dialog'
import ProgressStatusBar from '@/components/lib/Progress'
import { useVideoInfo } from '@/features/video/useVideoInfo'
import { Music, Video } from 'lucide-react'

const getBarLabel = (id: string) => {
  let label = ''
  if (id === 'temp_audio') {
    label = '音声データ'
  } else {
    label = '動画データ'
  }

  return label
}

const getBarLabelIcon = (id: string) => {
  let icon = <></>
  if (id === 'temp_audio') {
    icon = <Music className="h-full" size={14} />
  } else {
    icon = <Video className="h-full" size={14} />
  }

  return icon
}

function DownloadingDialog() {
  const { progress } = useVideoInfo()

  return (
    <Dialog modal open={progress.length > 0}>
      <DialogContent
        disableOutsideClick
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="flex flex-col items-center justify-center [&>button]:hidden"
      >
        <DialogHeader className="w-full">
          <DialogTitle className="text-primary w-full text-left">
            ダウンロード進行状況
          </DialogTitle>
          <DialogDescription hidden />
        </DialogHeader>
        {progress.length > 0 &&
          progress.map((p) => {
            return (
              <div
                key={p.downloadId}
                className="text-accent-foreground box-border w-full p-3"
              >
                <div className="flex items-center">
                  <span className="pr-0.5">
                    {getBarLabelIcon(p.downloadId)}
                  </span>
                  <span>{getBarLabel(p.downloadId)}</span>
                </div>
                <div className="px-3">
                  <ProgressStatusBar progress={p} />
                </div>
              </div>
            )
          })}
      </DialogContent>
    </Dialog>
  )
}

export default DownloadingDialog
