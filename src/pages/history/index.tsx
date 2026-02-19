import { useSelector } from '@/app/store'
import { useHistory } from '@/features/history/hooks/useHistory'
import type { HistoryEntry } from '@/features/history/model/historySlice'
import HistoryExportDialog from '@/features/history/ui/HistoryExportDialog'
import HistoryFilters from '@/features/history/ui/HistoryFilters'
import HistoryList from '@/features/history/ui/HistoryList'
import HistorySearch from '@/features/history/ui/HistorySearch'
import { usePendingDownload } from '@/shared/hooks/usePendingDownload'
import { selectHasActiveDownloads } from '@/shared/queue'
import { Button } from '@/shared/ui/button'
import { confirm, save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { FileText, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/**
 * 履歴ページコンテンツコンポーネント。
 *
 * これはレイアウトラッパーなしの履歴ページのコンテンツ部分です。
 * PageLayoutShellまたは同様のレイアウト内でレンダリングする必要があります。
 *
 * 以下を含む完全な機能を持つ履歴管理インターフェースを提供します：
 * - 検索・フィルタ機能
 * - JSON/CSVへのエクスポート
 * - 確認付き全履歴消去
 * - 大きなリスト用仮想スクロール
 *
 * @example
 * ```tsx
 * // PersistentPageLayout内
 * <HistoryContent />
 * ```
 */
export function HistoryContent() {
  const { t } = useTranslation()
  const hasActiveDownloads = useSelector(selectHasActiveDownloads)
  const handleDownload = usePendingDownload()

  const {
    entries,
    loading,
    filters,
    searchQuery,
    remove,
    clear,
    setSearch,
    updateFilters,
    exportData,
  } = useHistory()

  const [exportDialogOpen, setExportDialogOpen] = useState(false)

  /**
   * Bilibili URLからページ番号を抽出します。
   *
   * @param url - Bilibili動画URL（例: "https://www.bilibili.com/video/BVxxx?p=2"）
   * @returns ページ番号（見つからない場合は1がデフォルト）
   */
  const extractPageFromUrl = (url: string): number => {
    const match = url.match(/[?&]p=(\d+)/)
    return match ? parseInt(match[1], 10) : 1
  }

  /**
   * 履歴エントリのダウンロードリクエストを処理します。
   *
   * エントリを保留中のダウンロードとして設定し、
   * 実際のダウンロードフローが続くホームページに移動します。
   *
   * @param entry - ダウンロードする履歴エントリ
   */
  const onDownload = (entry: HistoryEntry) => {
    if (entry.bvid) {
      const page = extractPageFromUrl(entry.url)
      handleDownload(entry.bvid, null, page)
    }
  }

  /**
   * コンポーネントマウント時または言語変更時にドキュメントタイトルを更新します。
   */
  useEffect(() => {
    document.title = `${t('history.title')} - ${t('app.title')}`
  }, [t])

  /**
   * 確認付きですべての履歴エントリを消去します。
   *
   * 誤削除を防止するために、続行前にネイティブ確認ダイアログを表示します。
   */
  const handleClearAll = async () => {
    if (await confirm(t('history.deleteAllConfirm'))) {
      clear()
    }
  }

  /**
   * 履歴データをJSONまたはCSV形式でエクスポートします。
   *
   * プロセス:
   * 1. 履歴エントリを選択した形式に変換
   * 2. ネイティブファイル保存ダイアログを表示
   * 3. 選択したファイルパスにデータを書き込み
   * 4. 成功/エラートースト通知を表示
   *
   * @param format - エクスポート形式（'json'または'csv'）
   */
  const handleExport = async (format: 'json' | 'csv') => {
    try {
      const data = await exportData(format)

      // Show file save dialog
      const filePath = await save({
        title: t('history.exportTitle'),
        defaultPath: `history.${format}`,
        filters: [
          {
            name: format.toUpperCase(),
            extensions: [format],
          },
        ],
      })

      if (!filePath) {
        // User cancelled the dialog
        return
      }

      // Write file to selected location
      await writeTextFile(filePath, data)

      toast.success(t('history.exportSuccess'))
      setExportDialogOpen(false)
    } catch (error) {
      console.error('Export failed:', error)
      toast.error(
        error instanceof Error ? error.message : t('history.exportFailed'),
      )
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-border shrink-0 border-b p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-xl font-semibold">{t('nav.downloadHistory')}</h1>
          <div className="flex flex-1 items-center gap-2">
            <HistorySearch value={searchQuery} onChange={setSearch} />
            <HistoryFilters
              value={filters.status || 'all'}
              onChange={(status) => updateFilters({ status })}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExportDialogOpen(true)}
            >
              <FileText size={18} />
              <span className="hidden md:inline">
                {t('history.exportTitle')}
              </span>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleClearAll}
              disabled={entries.length === 0}
            >
              <Trash2 size={18} />
              <span className="hidden md:inline">{t('history.clearAll')}</span>
            </Button>
          </div>
        </div>
      </div>

      <HistoryList
        entries={entries}
        loading={loading}
        onDelete={remove}
        onDownload={onDownload}
        disabled={hasActiveDownloads}
        height="calc(100dvh - 2.3rem - 80px)"
      />

      <HistoryExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        onExport={handleExport}
      />
    </div>
  )
}

export default HistoryContent
