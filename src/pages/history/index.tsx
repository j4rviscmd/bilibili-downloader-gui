import { useHistory } from '@/features/history/hooks/useHistory'
import HistoryExportDialog from '@/features/history/ui/HistoryExportDialog'
import HistoryFilters from '@/features/history/ui/HistoryFilters'
import HistoryList from '@/features/history/ui/HistoryList'
import HistorySearch from '@/features/history/ui/HistorySearch'
import { PageLayout } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { ScrollArea, ScrollBar } from '@/shared/ui/scroll-area'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { FileText, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

function HistoryPage() {
  const { t } = useTranslation()

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

  useEffect(() => {
    document.title = `${t('history.title')} - ${t('app.title')}`
  }, [t])

  const handleClearAll = () => {
    if (confirm(t('history.deleteAllConfirm'))) {
      clear()
    }
  }

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
          {/* Header with search, filters, and action buttons */}
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

          {/* History list with scrollable content */}
          <ScrollArea
            className="flex-1"
            style={{ height: 'calc(100dvh - 2.3rem - 80px)' }}
          >
            <HistoryList
              entries={entries}
              loading={loading}
              onDelete={remove}
            />
            <ScrollBar />
          </ScrollArea>
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
