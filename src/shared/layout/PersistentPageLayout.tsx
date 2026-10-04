import { PageLayoutShell } from '@/shared/layout/PageLayout'
import { PAGE_PATHS } from '@/shared/layout/pages'
import type { FC, ReactElement } from 'react'
import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router'

import { AudioContent } from '@/pages/audio'
import { ConcatContent } from '@/pages/concat'
import { DownloadsContent } from '@/pages/downloads'
import { FavoriteContent } from '@/pages/favorite'
import { GifContent } from '@/pages/gif'
import { HistoryContent } from '@/pages/history'
import { ResolutionContent } from '@/pages/resolution'
import { RotationContent } from '@/pages/rotation'
import { SearchContent } from '@/pages/search'
import { SettingsContent } from '@/pages/settings'
import { TrimContent } from '@/pages/trim'
import { VideoSearchContent } from '@/pages/video-search'
import { WatchHistoryContent } from '@/pages/watch-history'

interface PageConfig {
  readonly path: string
  readonly Component: FC
}

// Why: exported only for the PAGES/PAGE_PATHS parity guard test — drift
// between the mount table and the shared path list breaks navigation.
export const PAGES: readonly PageConfig[] = [
  { path: '/video-search', Component: VideoSearchContent },
  { path: '/search', Component: SearchContent },
  { path: '/downloads', Component: DownloadsContent },
  { path: '/history', Component: HistoryContent },
  { path: '/favorite', Component: FavoriteContent },
  { path: '/watch-history', Component: WatchHistoryContent },
  { path: '/trim', Component: TrimContent },
  { path: '/concat', Component: ConcatContent },
  { path: '/audio', Component: AudioContent },
  { path: '/resolution', Component: ResolutionContent },
  { path: '/rotation', Component: RotationContent },
  { path: '/gif', Component: GifContent },
  { path: '/settings', Component: SettingsContent },
] as const

// Why: single source shared with the startup-page redirect validation and
// the Settings startup-page options (src/shared/layout/pages.ts).
const VALID_PATHS: readonly string[] = PAGE_PATHS

function isValidPath(pathname: string): boolean {
  return VALID_PATHS.includes(pathname)
}

/**
 * Persistent page layout component.
 *
 * This component implements a persistent page pattern where:
 * 1. The sidebar and app bar are shared across all pages (never unmount)
 * 2. Page content is lazy-mounted on first visit and kept in DOM
 * 3. Inactive pages are hidden with display:none to preserve state
 * 4. Active pages are shown with their normal display
 *
 * Per-page content frames (max-width centering, header, body scroll mode)
 * are owned by each page via PageTemplate, so this layout only handles
 * mounting and the shared chrome.
 *
 * Benefits:
 * - Scroll position is preserved when navigating back to a page
 * - Form inputs and search queries remain intact
 * - No "reload" feeling when switching pages
 * - Sidebar state (collapsed/expanded) persists
 *
 * @example
 * ```tsx
 * <Route path="/*" element={<PersistentPageLayout />} />
 * ```
 */
export function PersistentPageLayout(): ReactElement {
  const { pathname } = useLocation()
  const [mountedPages, setMountedPages] = useState<Set<string>>(
    () => new Set(['/search']),
  )

  useEffect(() => {
    if (isValidPath(pathname) && !mountedPages.has(pathname)) {
      setMountedPages((prev) => new Set([...prev, pathname]))
    }
  }, [pathname])

  if (!isValidPath(pathname)) {
    return <Navigate to="/search" replace />
  }

  return (
    <PageLayoutShell>
      {PAGES.map(({ path, Component }) =>
        mountedPages.has(path) ? (
          <div
            key={path}
            style={{ display: pathname === path ? undefined : 'none' }}
            className="min-h-0 w-full flex-1"
          >
            <div className="h-full w-full overflow-hidden">
              <Component />
            </div>
          </div>
        ) : null,
      )}
    </PageLayoutShell>
  )
}
