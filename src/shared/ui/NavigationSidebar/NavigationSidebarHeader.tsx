import { useSelector } from '@/app/store'
import { Download } from '@/shared/animate-ui/icons/download'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/shared/animate-ui/radix/sidebar'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import {
  NAV_GROUPS,
  PAGE_DEFS,
  isPageEnabled,
  pageKey,
} from '@/shared/layout/pages'
import { cn } from '@/shared/lib/utils'
import { selectActivePartCount, selectHasActiveDownloads } from '@/shared/queue'
import type { LucideIcon } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'

type NavigationSidebarHeaderProps = {
  className?: string
}

type MenuItem = {
  /** Entry path (nav target / disabledPages key). */
  path: string
  /** All routes of the feature — any of them keeps the item active. */
  paths: readonly string[]
  icon: LucideIcon
  label: string
  ariaLabel: string
  // Stable hook for E2E selectors; i18n-proof unlike ariaLabel
  testId?: string
  requiresAuth: boolean
}

type MenuGroup = {
  id: string
  label?: string
  items: MenuItem[]
}

/**
 * Navigation sidebar header with categorized menu items.
 *
 * Layout (task-flow order: find a video → download it → process local
 * files; decided 2026-10-22):
 * - Find category:
 *   - Video Search (/popular, results at /video-search) - anonymous entry
 *   - Fetch by URL (/search)
 *   - Favorite (/favorite) - requires login
 *   - Watch History (/watch-history) - requires login
 * - Download category:
 *   - Downloads (/downloads) - active download queue
 *   - Download History (/history) - completed downloads log
 * - Tool category:
 *   - Trim (/trim) - Trim local MP4 files by start/end time
 *   - Concat (/concat) - Concatenate multiple MP4 files into one
 *   - Audio (/audio) - Extract the audio track from a local file
 *   - Resolution (/resolution) - Re-encode a local file to another resolution
 *   - Rotation (/rotation) - Rotate a local file
 *   - GIF (/gif) - Generate GIF/WebM animations from local MP4 clips
 *
 * Note: Settings (/settings) is provided separately in SidebarFooter.
 *
 * Highlights the current page with active state styling.
 * Items requiring authentication are disabled with tooltip
 * when not logged in.
 */
export function NavigationSidebarHeader({
  className,
}: NavigationSidebarHeaderProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const user = useSelector((state) => state.user)
  const isLoggedIn = user.hasCookie && user.data?.isLogin
  const hasActiveDownloads = useSelector(selectHasActiveDownloads)
  const activePartCount = useSelector(selectActivePartCount)
  // Last feature location the user viewed, per sidebar item. The sidebar
  // never unmounts (persistent chrome), so it observes every visit: the
  // 動画検索 item returns to the /video-search?q=… results page when a
  // search was open (else /popular), and the URL取得 item returns to the
  // last /search entry — the loaded video with its ?url=…&page=… query,
  // or the empty hero entry after the video was closed.
  const lastVideoSearchPath = useRef('/popular')
  const lastSearchPath = useRef('/search')
  useEffect(() => {
    const { pathname, search } = location
    if (pathname === '/popular' || pathname === '/video-search') {
      lastVideoSearchPath.current = pathname + search
    }
    if (pathname === '/search') {
      lastSearchPath.current = pathname + search
    }
  }, [location.pathname, location.search])

  const disabledPages = useSelector((state) => state.settings.disabledPages)
  // Why derived from the registry: the sidebar, the layout mount table,
  // and the Settings startup/visibility lists must never drift apart.
  // Disabled pages drop out of their group; a group left with no items
  // hides entirely (label included).
  const groups = useMemo<MenuGroup[]>(
    () =>
      NAV_GROUPS.map((group) => ({
        id: group.id,
        label: t(group.labelKey),
        items: PAGE_DEFS.filter(
          (def) =>
            def.groupId === group.id && isPageEnabled(def, disabledPages),
        ).map((def) => ({
          // Why non-null assertions: only grouped defs reach here, and
          // the registry test pins icon/ariaKey presence for those.
          path: pageKey(def),
          paths: def.routes.map((route) => route.path),
          icon: def.icon!,
          label: t(def.labelKey),
          ariaLabel: t(def.ariaKey!),
          testId: def.testId,
          requiresAuth: def.requiresAuth ?? false,
        })),
      })).filter((group) => group.items.length > 0),
    [t, disabledPages],
  )

  const renderItem = (item: MenuItem) => {
    const Icon = item.icon
    // Why paths (all routes of the feature): the 動画検索 item targets
    // the /popular entry view, but /video-search is the same feature's
    // results page — it must keep the item active instead of deselecting.
    const isActive = item.paths.includes(location.pathname)
    const isDisabled = item.requiresAuth && !isLoggedIn
    const isSearch = item.path === '/search'

    /**
     * Click handler for navigation menu items.
     *
     * The active item is a no-op: clicking it neither navigates away from
     * the current view (e.g. the 動画検索 item is active on both /popular
     * and the /video-search results page) nor pushes a duplicate history
     * entry for the same path.
     *
     * For the URL取得 item, navigates back to the last /search entry
     * (video with its ?url=…&page=… query, or the empty hero), mirroring
     * the 動画検索 item: the persistent layout keeps the page mounted, so
     * the loaded video reappears without a refetch.
     *
     * For other items, performs a plain path navigation.
     * Disabled items (auth required but not logged in) are no-ops.
     */
    const handleClick = () => {
      if (isDisabled || isActive) return
      if (isSearch) {
        // Why: a bare /search navigation would hit the page's empty-entry
        // reset (src/pages/search/index.tsx) and wipe the loaded video; the
        // recorded entry keeps its ?url=…&page=… query, which avoids it.
        navigate(lastSearchPath.current)
      } else if (item.path === '/popular') {
        // 動画検索 returns to the feature's last-viewed page (results with
        // its ?q= when a search was open, else the popular feed).
        navigate(lastVideoSearchPath.current)
      } else {
        navigate(item.path)
      }
    }

    const button = (
      <SidebarMenuButton
        isActive={isActive}
        tooltip={isDisabled ? undefined : item.label}
        onClick={handleClick}
        aria-label={item.ariaLabel}
        data-testid={item.testId}
        aria-current={isActive ? 'page' : undefined}
        aria-disabled={isDisabled || undefined}
        className={isDisabled ? 'cursor-not-allowed opacity-50' : undefined}
      >
        {item.path === '/downloads' && hasActiveDownloads ? (
          <Download
            animate={true}
            animation="default-loop"
            loop={true}
            size={16}
          />
        ) : (
          <Icon />
        )}
        <span>{item.label}</span>
      </SidebarMenuButton>
    )

    return (
      <SidebarMenuItem key={item.path}>
        {isDisabled ? (
          <Tooltip>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>
              <p>{t('nav.favoriteLoginRequired')}</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          button
        )}
        {/* Why explicit top-1.5 on the badge: the vendored button sits
            inside a MotionHighlightItem div, so the badge's
            peer-data-[size] top variants never match (not DOM siblings)
            and the badge would fall to its static position below the
            button. */}
        {/* Why bg-brand: the bilibili pink token (--brand), not --primary. */}
        {/* Why z-[2]: MotionHighlightItem injects `relative z-[1]` into the
            button, and the active item paints an opaque bg-sidebar-accent on
            it — a z-auto badge that overlaps the button's right edge hides
            behind that background for as long as /downloads is open. */}
        {/* Note: the injected `relative z-[1]` comes from the vendored
            MotionHighlightItem cloneElement in
            src/shared/animate-ui/effects/motion-highlight.tsx; no test pins
            that class, so re-vendoring can silently reintroduce the bug. */}
        {item.path === '/downloads' && activePartCount > 0 ? (
          <SidebarMenuBadge className="bg-brand text-brand-foreground top-1.5 z-[2] rounded-full">
            {activePartCount}
          </SidebarMenuBadge>
        ) : null}
      </SidebarMenuItem>
    )
  }

  return (
    <TooltipProvider>
      <nav
        aria-label={t('nav.aria.mainNavigation')}
        className={cn('flex flex-col', className)}
      >
        {groups.map((group, index) => (
          <Fragment key={group.id}>
            {index > 0 && <SidebarSeparator className="mx-0 my-1" />}
            <SidebarGroup
              className={index < groups.length - 1 ? 'pb-0' : undefined}
            >
              {group.label ? (
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              ) : null}
              <SidebarGroupContent>
                <SidebarMenu>{group.items.map(renderItem)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </Fragment>
        ))}
      </nav>
    </TooltipProvider>
  )
}
