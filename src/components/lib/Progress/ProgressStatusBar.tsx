import {
  Progress,
  ProgressLabel,
  ProgressTrack,
} from '@/components/animate-ui/base/progress'
import type { Progress as ProgressType } from '@/shared/progress'
import { useTranslation } from 'react-i18next'

type Props = {
  progress: ProgressType
}

function ProgressStatusBar({ progress }: Props) {
  const { t } = useTranslation()
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
                {t('progress.elapsed')}: {Math.round(progress.elapsedTime)}s
              </div>
              <div className="w-1/3">
                {t('progress.speed')}:{' '}
                {(() => {
                  const kb = progress.transferRate || 0
                  if (kb >= 1000) {
                    return `${(kb / 1024).toFixed(1)}MB/s`
                  }
                  return `${kb.toFixed(0)}KB/s`
                })()}
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
              <div>
                {t('progress.elapsed')}: {progress.elapsedTime}s
              </div>
              <div />
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
