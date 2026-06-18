import { useAppDispatch, useSelector } from '@/app/store'
import { Download } from '@/shared/animate-ui/icons/download'
import { selectHasActiveDownloads } from '@/shared/queue'
import { useTranslation } from 'react-i18next'

import { openDownloadStatusDialog } from '../model/downloadStatusDialogSlice'
import { selectOverallSummary } from '../model/selectors'

/**
 * 右下固定のDL状況FAB（Floating Action Button）。
 *
 * DL対象がある時のみ表示。進行中DLがある時はアイコンをループアニメさせ、
 * 完了数/総数のバッジで注目させる。
 */
export function OpenDownloadStatusDialogButton() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const hasActive = useSelector(selectHasActiveDownloads)
  const summary = useSelector(selectOverallSummary)

  // Hide the FAB entirely when there are no downloads to show.
  if (summary.totalParts === 0) return null

  return (
    <button
      type="button"
      onClick={() => dispatch(openDownloadStatusDialog())}
      aria-label={t('downloadStatus.open')}
      className="bg-primary text-primary-foreground hover:bg-primary/90 fixed right-4 bottom-4 z-50 flex size-12 items-center justify-center rounded-full shadow-lg transition-all hover:scale-105 active:scale-95"
    >
      <Download
        animate={hasActive}
        animation={hasActive ? 'default-loop' : 'default'}
        loop={hasActive}
        size={20}
      />
      {summary.totalParts > 0 && (
        <span className="bg-destructive text-destructive-foreground absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-xs font-medium tabular-nums">
          {summary.completedCount}/{summary.totalParts}
        </span>
      )}
    </button>
  )
}
