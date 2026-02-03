import { useAppDispatch } from '@/app/store'
import { clearExpiredEntries } from '@/features/history'
import { useHistory } from '@/features/history/hooks/useHistory'
import HistoryExportDialog from '@/features/history/ui/HistoryExportDialog'
import HistoryFilters from '@/features/history/ui/HistoryFilters'
import HistoryList from '@/features/history/ui/HistoryList'
import HistorySearch from '@/features/history/ui/HistorySearch'
import { PageLayout } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { confirm, save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { FileText, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

/**
 * History page component.
 *
 * Provides a full-featured history management interface including:
 * - Search and filter functionality
 * - Export to JSON/CSV
 * - Clear all history with confirmation
 * - Virtual scrolling for large lists
 * - Automatic thumbnail cache cleanup on unmount
 */
function HistoryPage() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

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
   * Update document title when component mounts or language changes.
   */
  useEffect(() => {
    document.title = `${t('history.title')} - ${t('app.title')}`
  }, [t])

  /**
   * Cleanup expired thumbnail cache entries when page unmounts.
   *
   * This ensures memory is freed up when leaving the history page.
   */
  useEffect(() => {
    return () => {
      dispatch(clearExpiredEntries())
    }
  }, [dispatch])

  /**
   * Handles clearing all history entries with confirmation.
   *
   * Shows a native confirm dialog before proceeding to prevent accidental deletion.
   */
  const handleClearAll = async () => {
    const confirmed = await confirm(t('history.deleteAllConfirm'))
    if (confirmed) {
      clear()
    }
  }

  /**
   * Handles exporting history data to JSON or CSV format.
   *
   * Process:
   * 1. Convert history entries to the selected format
   * 2. Show native file save dialog
   * 3. Write data to the selected file path
   * 4. Display success/error toast notification
   *
   * @param format - Export format ('json' or 'csv')
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
    <>
      <PageLayout withScrollArea={false} innerClassName="h-full gap-0 p-0">
        <div className="flex h-full flex-col overflow-hidden">
          <div className="border-border shrink-0 border-b p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
                  <span className="hidden md:inline">
                    {t('history.clearAll')}
                  </span>
                </Button>
              </div>
            </div>
          </div>

          <HistoryList
            entries={entries}
            loading={loading}
            onDelete={remove}
            height="calc(100dvh - 2.3rem - 80px)"
          />
        </div>
      </PageLayout>

      <HistoryExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        onExport={handleExport}
      />
    </>
  )
}

export default HistoryPage
