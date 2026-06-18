import type { DownloadPartStatus } from '../model/types'

/** ステータスの表示トーン。アイコンや色の選択に使う。 */
export type StatusTone =
  | 'completed'
  | 'active'
  | 'waiting'
  | 'error'
  | 'cancelled'

/** ステータスごとの表示メタ。 */
export type StatusVisual = {
  /** i18n ラベルキー（downloadStatus.status_*） */
  labelKey: string
  /** ドットの Tailwind 背景クラス */
  dotClass: string
  tone: StatusTone
}

const MAP: Record<DownloadPartStatus, StatusVisual> = {
  done: {
    labelKey: 'downloadStatus.status_completed',
    dotClass: 'bg-green-500',
    tone: 'completed',
  },
  running: {
    labelKey: 'downloadStatus.status_downloading',
    dotClass: 'bg-blue-500',
    tone: 'active',
  },
  pending: {
    labelKey: 'downloadStatus.status_waiting',
    dotClass: 'bg-muted-foreground',
    tone: 'waiting',
  },
  cancelling: {
    labelKey: 'downloadStatus.status_cancelling',
    dotClass: 'bg-yellow-500',
    tone: 'cancelled',
  },
  cancelled: {
    labelKey: 'downloadStatus.status_cancelled',
    dotClass: 'bg-muted-foreground',
    tone: 'cancelled',
  },
  error: {
    labelKey: 'downloadStatus.status_error',
    dotClass: 'bg-destructive',
    tone: 'error',
  },
}

/** ステータスに対応する表示メタを返す。未定義時は pending 扱い。 */
export function getStatusVisual(status: DownloadPartStatus): StatusVisual {
  return MAP[status] ?? MAP.pending
}
