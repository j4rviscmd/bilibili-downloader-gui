import { useSelector } from '@/app/store'
import { PageLayoutShell } from '@/shared/layout/PageLayout'
import {
  PAGE_PATHS,
  PAGE_ROUTES,
  isPathEnabled,
  pageDefForPath,
} from '@/shared/layout/pages'
import { toast } from '@/shared/ui/toast'
import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation } from 'react-router'

function isValidPath(pathname: string): boolean {
  // Single source shared with the startup-page redirect validation and
  // the Settings startup-page options (src/shared/layout/pages.ts).
  return PAGE_PATHS.includes(pathname)
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
 * Page visibility (settings.disabledPages) additionally gates mounting:
 * a disabled page never mounts, unmounts the moment it gets disabled
 * (reclaiming its DOM/state memory), and any navigation to it (e.g. an
 * in-app deep link like the watch-history download handoff) is redirected
 * to /search with an explanatory toast.
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
  const { t } = useTranslation()
  const disabledPages = useSelector((state) => state.settings.disabledPages)
  const [mountedPages, setMountedPages] = useState<Set<string>>(
    () => new Set(['/search']),
  )
  // Why a ref guard: React StrictMode double-invokes effects in dev —
  // without it every disabled-page navigation toasts twice.
  const toastedPathRef = useRef<string | null>(null)

  const pathEnabled = isPathEnabled(pathname, disabledPages)
  // Known but hidden (unknown paths redirect silently below); only this
  // case earns an explanatory toast.
  const pathDisabled = isValidPath(pathname) && !pathEnabled

  // Mount pages lazily on first visit; unmount a page the moment it gets
  // disabled so its DOM/state memory is reclaimed (page visibility).
  useEffect(() => {
    setMountedPages((prev) => {
      const next = new Set(
        [...prev].filter((p) => isPathEnabled(p, disabledPages)),
      )
      if (pathEnabled) next.add(pathname)
      // Why return `prev` when unchanged: this effect re-runs on every
      // route change; a fresh Set each time would cause a needless re-render.
      return next.size === prev.size && [...next].every((p) => prev.has(p))
        ? prev
        : next
    })
  }, [pathname, disabledPages, pathEnabled])

  // Disabled pages stay reachable through in-app links (e.g. the
  // watch-history download handoff navigates to /search, the recent-URLs
  // list links to /history): notify instead of silently landing elsewhere.
  useEffect(() => {
    if (!pathDisabled) {
      toastedPathRef.current = null
      return
    }
    if (toastedPathRef.current === pathname) return
    toastedPathRef.current = pathname
    // pathDisabled implies the path is registered, so the def exists.
    toast.warning(
      t('settings.page_disabled_toast', {
        page: t(pageDefForPath(pathname)!.labelKey),
      }),
    )
  }, [pathDisabled, pathname, t])

  if (!pathEnabled) {
    return <Navigate to="/search" replace />
  }

  return (
    <PageLayoutShell>
      {PAGE_ROUTES.map(({ path, Component }) =>
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
