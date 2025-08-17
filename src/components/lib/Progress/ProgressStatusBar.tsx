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
      {progress.filesize ? (
        <>
          <div className="flex items-center justify-between">
            <ProgressLabel className="flex w-full items-center text-sm">
              <div className="w-1/3">
                経過: {Math.round(progress.elapsedTime)}s
              </div>
              <div className="w-1/3">
                速度: {progress.transferRate.toFixed(1)}MB/s
              </div>
              <div className="w-1/3">
                {progress.downloaded.toFixed(1)}mb/
                {progress.filesize.toFixed(1)}mb
              </div>
            </ProgressLabel>
          </div>
          <div className="flex items-center">
            <ProgressTrack
              className={progress.isComplete ? 'bg-chart-2' : ''}
            />
            <div className="mx-0.5" />
            <div className="text-sm font-semibold">{progress.percentage}%</div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <ProgressLabel className="flex w-full items-center justify-between text-sm">
              <div>経過: {progress.elapsedTime}s</div>
              <div></div>
            </ProgressLabel>
          </div>
          <div className="flex items-center">
            <ProgressTrack
              className={progress.isComplete ? 'bg-chart-2' : ''}
            />
            <div className="mx-0.5" />
            <div className="text-sm font-semibold">{progress.percentage}%</div>
          </div>
        </>
      )}
    </Progress>
  )
}

export default ProgressStatusBar
