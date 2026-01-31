import { useHistory } from '@/features/history/hooks/useHistory'
import HistoryExportDialog from '@/features/history/ui/HistoryExportDialog'
import HistoryFilters from '@/features/history/ui/HistoryFilters'
import HistoryList from '@/features/history/ui/HistoryList'
import HistorySearch from '@/features/history/ui/HistorySearch'
import { PageLayout } from '@/shared/layout'
import { Button } from '@/shared/ui/button'
import { FileText, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

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

      const blob = new Blob([data], {
        type: format === 'json' ? 'application/json' : 'text/csv',
      })

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `history.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Export failed:', error)
    }
  }

  return (
    <>
      <PageLayout withScrollArea={false} innerClassName="gap-0">
        {/* Header with search, filters, and action buttons */}
        <div className="border-border border-b p-3">
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

        {/* History list */}
        <div className="flex-1 overflow-hidden">
          <HistoryList entries={entries} loading={loading} onDelete={remove} />
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
