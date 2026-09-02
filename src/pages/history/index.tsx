import { useSelector } from '@/app/store'
import { useHistory } from '@/features/history/hooks/useHistory'
import type { HistoryEntry } from '@/features/history/model/historySlice'
import HistoryExportDialog from '@/features/history/ui/HistoryExportDialog'
import HistoryFilters from '@/features/history/ui/HistoryFilters'
import HistoryList from '@/features/history/ui/HistoryList'
import HistorySearch from '@/features/history/ui/HistorySearch'
import { usePendingDownload } from '@/shared/hooks/usePendingDownload'
import { PageTemplate } from '@/shared/layout'
import { selectHasActiveDownloads } from '@/shared/queue'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/ui/toast'
import { confirm, save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import { FileText, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'

import { logger } from '@/shared/lib/logger'

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
    refresh,
  } = useHistory()

  const [exportDialogOpen, setExportDialogOpen] = useState(false)

  // Re-fetch history whenever this page becomes visible again (issue #560).
  // Pages are kept mounted with display:none by PersistentPageLayout, so a
  // plain mount effect would run once per app launch — entries downloaded by
  // another app instance would stay invisible until restart. The component
  // stays mounted through this, so scroll position and search/filter state
  // are preserved; only the Redux entries array is replaced.
  const { pathname } = useLocation()
  const prevPathname = useRef(pathname)
  useEffect(() => {
    const becameVisible =
      prevPathname.current !== '/history' && pathname === '/history'
    prevPathname.current = pathname
    if (becameVisible) {
      refresh()
    }
  }, [pathname, refresh])

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
      logger.error('Export failed', error)
      toast.error(
        error instanceof Error ? error.message : t('history.exportFailed'),
      )
    }
  }

  return (
    <PageTemplate
      title={t('nav.downloadHistory')}
      actions={
        <>
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
        </>
      }
    >
      <div className="min-h-0 flex-1">
        <HistoryList
          entries={entries}
          loading={loading}
          onDelete={remove}
          onDownload={onDownload}
          disabled={hasActiveDownloads}
        />
      </div>

      <HistoryExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        onExport={handleExport}
      />
    </PageTemplate>
  )
}

export default HistoryContent
