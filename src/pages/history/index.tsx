import { useTheme } from '@/app/providers/ThemeContext'
import { useHistory } from '@/features/history/hooks/useHistory'
import HistoryExportDialog from '@/features/history/ui/HistoryExportDialog'
import HistoryFilters from '@/features/history/ui/HistoryFilters'
import HistoryList from '@/features/history/ui/HistoryList'
import HistorySearch from '@/features/history/ui/HistorySearch'
import { useUser } from '@/features/user'
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/shared/animate-ui/radix/sidebar'
import AppBar from '@/shared/ui/AppBar/AppBar'
import { Button } from '@/shared/ui/button'
import { NavigationSidebarHeader } from '@/shared/ui/NavigationSidebar'
import { FileText, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

function HistoryPage() {
  const { user } = useUser()
  const { theme, setTheme } = useTheme()
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
      <SidebarProvider defaultOpen={false}>
        <Sidebar>
          <NavigationSidebarHeader />
          <SidebarContent />
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <div className="flex h-full w-full flex-col">
            <header className="bg-accent flex">
              <SidebarTrigger
                size="lg"
                className="h-full shrink-0 cursor-pointer shadow-md"
              />
              <AppBar user={user} theme={theme} setTheme={setTheme} />
            </header>

            <div className="flex w-full flex-col">
              <div className="border-border border-b p-3">
                <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
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

              <div className="flex-1 overflow-hidden">
                <HistoryList
                  entries={entries}
                  loading={loading}
                  onDelete={remove}
                />
              </div>
            </div>
          </div>
        </SidebarInset>
      </SidebarProvider>

      <HistoryExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        onExport={handleExport}
      />
    </>
  )
}

export default HistoryPage
