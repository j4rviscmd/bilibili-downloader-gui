import {
  useVideoSearch,
  VideoSearchFilterBar,
  VideoSearchInput,
  VideoSearchPagination,
  VideoSearchResultList,
} from '@/features/video-search'
import { PageTemplate } from '@/shared/layout'
import { mapBackendError } from '@/shared/lib/mapBackendError'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Video search page content component.
 *
 * Keyword search over bilibili videos (no login required). Result cards
 * navigate to the URL search page to configure and start downloads.
 */
export function VideoSearchContent() {
  const { t } = useTranslation()
  const { loading, error, search } = useVideoSearch()

  useEffect(() => {
    document.title = `${t('videoSearch.title')} - ${t('app.title')}`
  }, [t])

  // Mapped ERR:: codes → i18n key; anything else (raw backend strings,
  // unmapped codes) falls back to the raw message with the ERR:: prefix
  // stripped. ERR::UNAUTHORIZED never occurs here — search works logged out.
  const errorText = error
    ? (mapBackendError(error) ?? error.replace(/^ERR::/, ''))
    : null
  return (
    <PageTemplate
      title={t('videoSearch.title')}
      actions={
        // Watch-history header pattern: the search box rides the title row
        // so it stays reachable while results scroll under it. flex-1 lets
        // the input grow; the suggest dropdown overlays the body via z-10.
        <div className="flex w-full flex-1 items-center gap-2 sm:w-auto">
          <VideoSearchInput onSearch={search} loading={loading} />
        </div>
      }
    >
      {/* pt/pb follow the PageTemplate body idiom (see its docstring) —
          horizontal padding comes from the template's body wrapper. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 pt-2 pb-4 sm:pt-3 sm:pb-6">
        {errorText && (
          <Alert variant="destructive" className="shrink-0">
            <AlertDescription>{errorText}</AlertDescription>
          </Alert>
        )}
        {/* Filter bar (bilibili-style order/duration/zone) rides above the
            scroll area so it stays reachable while results scroll. */}
        <VideoSearchFilterBar />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <VideoSearchResultList />
        </div>
        <VideoSearchPagination />
      </div>
    </PageTemplate>
  )
}

export default VideoSearchContent
