import {
  useVideoSearch,
  VideoCardGrid,
  VideoSearchFeedTail,
  VideoSearchFilterBar,
  VideoSearchInput,
  VideoSearchResultList,
} from '@/features/video-search'
import { PageTemplate } from '@/shared/layout'
import { mapBackendError } from '@/shared/lib/mapBackendError'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'

/**
 * Video search results page, driven by the `?q=` URL parameter.
 *
 * Keyword search over bilibili videos (no login required). Result cards
 * navigate to the URL search page to configure and start downloads.
 * Results accumulate page by page via infinite scroll (no pagination).
 *
 * URL contract:
 * - `/video-search?q=<keyword>` is one history entry per keyword: submitting
 *   a search pushes a new entry, so browser back/forward re-runs the
 *   previous keyword — a visited keyword restores its stacked feed
 *   (loaded cards + scroll position) without refetching.
 * - Without `q` and without a search in flight, the page is idle and
 *   redirects to the feature's entry view at /popular (legacy startup-page
 *   settings and bare direct URLs included).
 * - Filters intentionally stay OUT of the URL (requirement is
 *   keyword-level history only); they live in the search slice.
 */
export function VideoSearchContent() {
  const { t } = useTranslation()
  const {
    loading,
    error,
    search,
    searchStarted,
    keyword,
    entries,
    feeds,
    filters,
  } = useVideoSearch()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const q = searchParams.get('q')?.trim() ?? ''
  const scrollRef = useRef<HTMLDivElement>(null)
  // The keyword currently being viewed, per the URL. Falls back to the
  // committed slice keyword while q is absent (idle/redirect window) so
  // container selection stays consistent. Drives the stacked containers
  // below — see the comment there for why q, not `keyword`.
  const activeKw = q || keyword

  useEffect(() => {
    document.title = `${t('videoSearch.title')} - ${t('app.title')}`
  }, [t])

  // Fetch trigger: the URL keyword differs from the last fetched one.
  // Fires on direct URLs, on back/forward (q changes), and after the
  // setSearchParams below — one owner of the fetch, no double-fetch.
  useEffect(() => {
    if (q && q !== keyword) search(q)
  }, [q, keyword, search])

  // A filter change replaces the active feed's cards in place — return to
  // the top so the fresh results are in view. Keyword switches do NOT
  // scroll: each keyword renders in its own stacked container that kept
  // its scroll position (see the containers below).
  const prevKeyword = useRef(keyword)
  useEffect(() => {
    const keywordSwitched = prevKeyword.current !== keyword
    prevKeyword.current = keyword
    if (keywordSwitched) return
    scrollRef.current?.scrollTo({ top: 0 })
  }, [keyword, filters])

  // Why a navigate() effect instead of <Navigate>: PersistentPageLayout
  // keeps this page mounted (display:none) after the redirect, and in the
  // declarative router <Navigate> re-fires on EVERY later location change
  // (useNavigate's identity tracks the pathname) — the hidden idle copy
  // would yank the user back to /popular on each navigation.
  useEffect(() => {
    if (!searchStarted && !q) navigate('/popular', { replace: true })
    // Why navigate is excluded from deps: its identity tracks the pathname
    // in the declarative router — including it re-fires this effect on
    // every location change and yanks the user back to /popular
    // (regression guarded by the persistent-layout test).
  }, [searchStarted, q])

  // Submitting from this page pushes a history entry (back returns to the
  // previous keyword's results); the fetch itself is owned by the effect
  // above reacting to the new q.
  const handleSearch = useCallback(
    (kw: string) => {
      const trimmed = kw.trim()
      if (!trimmed) return
      // Same-keyword resubmit (e.g. retry after a failed search): refetch
      // in place — setSearchParams would push a duplicate history entry
      // and the effect's q !== keyword guard would block the fetch.
      if (trimmed === q) {
        // Same-keyword resubmit: intentional refresh — bypass the cache.
        search(trimmed, { fresh: true })
        return
      }
      setSearchParams({ q: trimmed })
    },
    [q, search, setSearchParams],
  )

  if (!searchStarted) return null

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
        // the input grow; the suggest dropdown overlays the body via z-50.
        <div className="flex w-full flex-1 items-center gap-2 sm:w-auto">
          <VideoSearchInput
            onSearch={handleSearch}
            loading={loading}
            keyword={q}
          />
        </div>
      }
    >
      {/* pt/pb follow the PageTemplate body idiom (see its docstring) —
          horizontal padding comes from the template's body wrapper. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 pt-2 pb-4 sm:pt-3 sm:pb-6">
        {/* First-search failure only: later-page failures surface as a
            tail error row inside the list (the top Alert would be out of
            the viewport while scrolled deep). */}
        {errorText && entries.length === 0 && (
          <Alert variant="destructive" className="shrink-0">
            <AlertDescription>{errorText}</AlertDescription>
          </Alert>
        )}
        {/* Filter bar (bilibili-style order/duration/zone) rides above the
            scroll area so it stays reachable while results scroll. */}
        <VideoSearchFilterBar />
        {/* Stacked per-keyword scroll containers: switching keywords only
            toggles visibility, so each feed keeps its loaded cards and its
            scroll position natively (scrollTop survives display:none —
            the same mechanism PersistentPageLayout relies on).

            Why the ACTIVE container is picked by the URL `q` (not the
            success-committed slice keyword): submitting a NEW keyword
            changes q synchronously, so the previous keyword's container
            flips to its hidden/stored form BEFORE the fetch's
            resetEntries could swap a skeleton into it — that swap would
            collapse the content height and clamp away the stored scroll
            position. While a restore/fetch is still catching up
            (active but not committed), the live tail stays unmounted so
            the container never shows another keyword's fetch states. */}
        {Object.entries(feeds).map(([kw, feed]) => {
          const active = kw === activeKw
          const committed = kw === keyword
          return (
            <div
              key={kw}
              ref={active ? scrollRef : undefined}
              className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
              style={active ? undefined : { display: 'none' }}
            >
              {/* The grid is ALWAYS this container's first child at a
                  stable type/position: React reuses the card <img> nodes
                  across the live/hidden switch, so restoring a keyword
                  never reloads its thumbnails. */}
              <VideoCardGrid entries={feed.entries} />
              {active && committed && (
                <VideoSearchFeedTail scrollRootRef={scrollRef} />
              )}
            </div>
          )
        })}
        {/* A keyword without a stored feed (first fetch in flight or
            failed): a transient container owns the skeleton/empty/error
            states until the first success files the keyword into the
            stack above. (Known 1-frame cosmetic: on back/forward to an
            EVICTED keyword the previous feed's cards may flash before
            the fetch effect resets — gating on q === keyword would
            trade that for a blank, skeleton-less fetch, which is
            worse.) */}
        {!feeds[activeKw] && (
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <VideoSearchResultList scrollRootRef={scrollRef} />
          </div>
        )}
      </div>
    </PageTemplate>
  )
}

export default VideoSearchContent
