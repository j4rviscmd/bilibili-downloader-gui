import {
  Progress,
  ProgressLabel,
  ProgressTrack,
} from '@/components/animate-ui/base/progress'
import type { Progress as ProgressType } from '@/shared/progress'

type Props = {
  progress: ProgressType
}

function ProgressStatusBar({ progress }: Props) {
  return (
    <Progress
      value={progress.percentage}
      className="text-muted-foreground w-full"
    >
      <div className="flex items-center justify-between">
        <ProgressLabel className="flex w-full items-center justify-between text-sm">
          <div>経過時間: {progress.elapsedTime}秒</div>
          <div>速度: {progress.transferRate}MB/s</div>
          <div>
            {progress.downloaded}mb/{progress.filesize}mb
          </div>
        </ProgressLabel>
      </div>
      <div className="flex items-center">
        <ProgressTrack />
        <div className="mx-0.5" />
        <div className="text-sm font-semibold">{progress.percentage}%</div>
      </div>
    </Progress>
  )
}

export default ProgressStatusBar
