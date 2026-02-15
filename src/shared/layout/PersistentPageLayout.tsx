import { PageLayoutShell } from '@/shared/layout/PageLayout'
import { cn } from '@/shared/lib/utils'
import { ScrollArea, ScrollBar } from '@/shared/ui/scroll-area'
import type { FC, ReactElement } from 'react'
import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router'

import { FavoriteContent } from '@/pages/favorite'
import { HistoryContent } from '@/pages/history'
import { HomeContent } from '@/pages/home'
import { WatchHistoryContent } from '@/pages/watch-history'

interface PageConfig {
  readonly path: string
  readonly Component: FC
  readonly withScrollArea?: boolean
  readonly maxWidth?: boolean
}

const PAGES: readonly PageConfig[] = [
  { path: '/home', Component: HomeContent, withScrollArea: true },
  { path: '/history', Component: HistoryContent, maxWidth: true },
  { path: '/favorite', Component: FavoriteContent, maxWidth: true },
  { path: '/watch-history', Component: WatchHistoryContent, maxWidth: true },
] as const

const VALID_PATHS = new Set(PAGES.map((p) => p.path))

/**
 * Persistent page layout component.
 *
 * This component implements a persistent page pattern where:
 * 1. The sidebar and app bar are shared across all pages (never unmount)
 * 2. Page content is lazy-mounted on first visit and kept in DOM
 * 3. Inactive pages are hidden with display:none to preserve state
 * 4. Active pages are shown with their normal display
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
    () => new Set(['/home']),
  )

  const isValidPath = VALID_PATHS.has(pathname)

  useEffect(() => {
    if (isValidPath && !mountedPages.has(pathname)) {
      setMountedPages((prev) => new Set([...prev, pathname]))
    }
  }, [pathname, isValidPath, mountedPages])

  if (!isValidPath) {
    return <Navigate to="/home" replace />
  }

  return (
    <PageLayoutShell>
      {PAGES.map(({ path, Component, withScrollArea, maxWidth }) => {
        if (!mountedPages.has(path)) return null

        const isActive = pathname === path

        return (
          <div key={path} hidden={!isActive} className="h-full w-full">
            {withScrollArea ? (
              <ScrollArea
                style={{ height: 'calc(100dvh - 2.3rem)' }}
                className="flex w-full"
              >
                <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-3 sm:px-6">
                  <Component />
                </div>
                <ScrollBar />
              </ScrollArea>
            ) : (
              <div
                className={cn('h-full w-full', maxWidth && 'mx-auto max-w-5xl')}
              >
                <Component />
              </div>
            )}
          </div>
        )
      })}
    </PageLayoutShell>
  )
}
