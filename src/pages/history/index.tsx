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
 * History page content component.
 *
 * Provides search and filter functionality, JSON/CSV export, clear all with confirmation,
 * and virtual scrolling for the history list.
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
   * Extracts the page number from a Bilibili URL.
   * @param url - The Bilibili video URL
   * @returns The page number (defaults to 1 if not found)
   */
  const extractPageFromUrl = (url: string): number => {
    const match = url.match(/[?&]p=(\d+)/)
    return match ? parseInt(match[1], 10) : 1
  }

  /**
   * Handles download request from a history entry.
   * Extracts bvid and page number, then navigates to home page.
   * @param entry - The history entry to download
   */
  const onDownload = (entry: HistoryEntry) => {
    if (entry.bvid) {
      const page = extractPageFromUrl(entry.url)
      handleDownload(entry.bvid, null, page)
    }
  }

  /**
   * Updates document title on mount or language change.
   * Sets the page title for browser history and tab display.
   */
  useEffect(() => {
    document.title = `${t('history.title')} - ${t('app.title')}`
  }, [t])

  /**
   * Clears all history entries with user confirmation.
   * Shows a confirmation dialog before clearing the history.
   */
  const handleClearAll = async () => {
    if (await confirm(t('history.deleteAllConfirm'))) {
      clear()
    }
  }

  /**
   * Exports history data to JSON or CSV format.
   * Shows a file save dialog and writes the exported data to the selected location.
   * @param format - The export format ('json' or 'csv')
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
