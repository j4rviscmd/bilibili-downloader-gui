import { PopularFeedList } from '@/features/popular'
import { VideoSearchInput, useVideoSearch } from '@/features/video-search'
import { usePageTitle } from '@/shared/hooks/usePageTitle'
import { PageTemplate } from '@/shared/layout'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

/**
 * Popular (おすすめ) feed page — the video-search feature's default entry
 * view (bilibili-style recommendations, infinite scroll, no pagination).
 *
 * The search box starts a keyword search and hands off to /video-search
 * (the search results page). Browser back / the sidebar return here with
 * the loaded feed and scroll position intact (persistent layout).
 */
export function PopularContent() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { loading } = useVideoSearch()
  const scrollRef = useRef<HTMLDivElement>(null)

  usePageTitle('popular.title')

  const handleSearch = useCallback(
    (kw: string) => {
      const trimmed = kw.trim()
      if (!trimmed) return
      navigate({
        pathname: '/video-search',
        search: `?q=${encodeURIComponent(trimmed)}`,
      })
    },
    [navigate],
  )

  return (
    <PageTemplate
      title={t('popular.title')}
      actions={
        // Same header pattern as the video-search page: the search box
        // rides the title row and stays reachable while the feed scrolls.
        <div className="flex w-full flex-1 items-center gap-2 sm:w-auto">
          <VideoSearchInput onSearch={handleSearch} loading={loading} />
        </div>
      }
    >
      {/* pt/pb follow the PageTemplate body idiom (see its docstring) —
          horizontal padding comes from the template's body wrapper. The
          scroll container ref scopes the feed's IntersectionObserver. */}
      <div className="flex min-h-0 flex-1 flex-col pt-2 pb-4 sm:pt-3 sm:pb-6">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <PopularFeedList scrollRootRef={scrollRef} />
        </div>
      </div>
    </PageTemplate>
  )
}

export default PopularContent
