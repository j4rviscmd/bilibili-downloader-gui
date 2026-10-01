import {
  useVideoSearch,
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
    <PageTemplate title={t('videoSearch.title')}>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <VideoSearchInput onSearch={search} loading={loading} />
        {errorText && (
          <Alert variant="destructive" className="shrink-0">
            <AlertDescription>{errorText}</AlertDescription>
          </Alert>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? null : <VideoSearchResultList />}
        </div>
        <VideoSearchPagination />
      </div>
    </PageTemplate>
  )
}

export default VideoSearchContent
