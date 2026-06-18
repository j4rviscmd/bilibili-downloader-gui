import { useAppDispatch, useSelector } from '@/app/store'
import { cancelAllDownloads } from '@/shared/queue'
import { Button } from '@/shared/ui/button'
import { useTranslation } from 'react-i18next'

import { formatElapsed } from '../lib/format'
import { selectOverallSummary } from '../model/selectors'

/**
 * ダイアログヘッダーの全体進捗バー。
 *
 * trim風の薄いバー + 完了数 + 経過時間 + すべてキャンセル。
 * 「すべてキャンセル」は既存の cancelAllDownloads thunk（バックエンドへ
 * キャンセルを通知）を dispatch する。
 */
export function OverallProgressBar() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const summary = useSelector(selectOverallSummary)
  const percent = Math.min(100, Math.round(summary.overallRatio * 100))

  const handleCancelAll = () => {
    dispatch(cancelAllDownloads())
  }

  return (
    <div className="flex items-center gap-3">
      <div className="bg-primary/20 relative h-2 flex-1 overflow-hidden rounded-full">
        <div
          className="bg-primary h-full transition-[width] duration-1000 ease-linear"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-sm font-medium whitespace-nowrap tabular-nums">
        {summary.completedCount}/{summary.totalParts}
      </span>
      <span className="text-muted-foreground text-sm whitespace-nowrap tabular-nums">
        {t('downloadStatus.elapsed')} {formatElapsed(summary.elapsedSeconds)}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={handleCancelAll}
        disabled={!summary.hasActive}
      >
        {t('downloadStatus.cancel_all')}
      </Button>
    </div>
  )
}
