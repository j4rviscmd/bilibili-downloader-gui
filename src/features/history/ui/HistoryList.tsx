import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import type { HistoryEntry } from '../model/historySlice'
import HistoryItem from './HistoryItem'

/**
 * HistoryListコンポーネントのプロパティ。
 *
 * @property entries - 表示する履歴エントリの配列
 * @property loading - 履歴データが現在読み込み中かどうか
 * @property onDelete - エントリ削除時のコールバック関数
 * @property onDownload - ダウンロードボタンクリック時のコールバック関数
 * @property disabled - ダウンロードボタンを無効にするかどうか
 * @property height - 仮想スクロールコンテナのオプションの高さ
 */
type Props = {
  entries: HistoryEntry[]
  loading: boolean
  onDelete: (id: string) => void
  onDownload?: (entry: HistoryEntry) => void
  disabled?: boolean
  height?: string
}

/** 各HistoryItemのおおよその高さ（ピクセル単位、仮想スクロール用） */
const DEFAULT_ITEM_HEIGHT = 120 // 各HistoryItemのおおよその高さ

/**
 * 空状態アイコンコンポーネント。
 *
 * 履歴エントリがないことを表すスタイライズされたフィルム/グリッドアイコンを表示します。
 */
const EmptyStateIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="64"
    height="64"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    className="opacity-20"
  >
    <path d="M3 3h18M21 3v5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v5M21 21v-5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v5M3 8h18M12 3v18" />
  </svg>
)

/**
 * ローディング、空状態、仮想スクロールを備えた履歴リストコンポーネント。
 *
 * 機能:
 * - スピナー付きローディング状態
 * - アイコンとメッセージ付き空状態
 * - 大きなリストの効率的なレンダリング用仮想スクロール
 * - レスポンシブ高さ計算
 * - bvidを持つエントリのダウンロードボタン
 *
 * @example
 * ```tsx
 * <HistoryList
 *   entries={history.entries}
 *   loading={history.loading}
 *   onDelete={(id) => history.remove(id)}
 *   onDownload={(entry) => handleDownload(entry)}
 *   disabled={hasActiveDownloads}
 *   height="calc(100dvh - 2.3rem - 80px)"
 * />
 * ```
 */
function HistoryList({
  entries,
  loading,
  onDelete,
  onDownload,
  disabled,
  height,
}: Props) {
  const { t } = useTranslation()

  // Loading state - shows animated text
  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-muted-foreground animate-pulse">
          {t('init.initializing')}
        </div>
      </div>
    )
  }

  // Empty state - shows icon and message when no entries exist
  if (entries.length === 0) {
    return (
      <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 p-8">
        <div className="text-muted-foreground/60 flex size-32 items-center justify-center">
          <EmptyStateIcon />
        </div>
        <p className="text-muted-foreground text-center text-lg">
          {t('history.empty')}
        </p>
      </div>
    )
  }

  // Virtualized list for efficient rendering of large datasets
  return (
    <Virtuoso
      style={{ height }}
      data={entries}
      itemContent={(_index, entry) => (
        <div key={entry.id} className="py-1">
          <HistoryItem
            entry={entry}
            onDelete={() => onDelete(entry.id)}
            onDownload={onDownload ? () => onDownload(entry) : undefined}
            disabled={disabled}
          />
        </div>
      )}
      defaultItemHeight={DEFAULT_ITEM_HEIGHT}
    />
  )
}

export default HistoryList
