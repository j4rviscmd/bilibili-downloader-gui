import { useSelector } from '@/app/store'
import { selectHomePage } from '@/features/video'
import { Download } from '@/shared/animate-ui/icons/download'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
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
import { cn } from '@/shared/lib/utils'
import { selectHasActiveDownloads } from '@/shared/queue'
import type { LucideIcon } from 'lucide-react'
import {
  Combine,
  Download as DownloadIcon,
  Eye,
  ImagePlay,
  Link,
  Music,
  RotateCw,
  Scaling,
  Scissors,
  Search,
  Star,
} from 'lucide-react'
import { Fragment, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'

type NavigationSidebarHeaderProps = {
  className?: string
}

type MenuItem = {
  path: string
  icon: LucideIcon
  label: string
  ariaLabel: string
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
 * Layout:
 * - Home (/home) - standalone (no category), video download interface
 * - Bilibili category:
 *   - Favorite (/favorite) - requires login
 *   - Watch History (/watch-history) - requires login
 * - Tool category:
 *   - Trim (/trim) - Trim local MP4 files by start/end time
 *   - Concat (/concat) - Concatenate multiple MP4 files into one
 *   - GIF (/gif) - Generate GIF/WebM animations from local MP4 clips
 *
 * Note: Download history (/history) is provided separately in SidebarFooter.
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
  const homePage = useSelector(selectHomePage)
  // Last video-search-feature location the user viewed. The sidebar never
  // unmounts (persistent chrome), so it observes every visit; clicking the
  // 動画検索 item returns there — the /video-search?q=… results page when a
  // search was open, otherwise the /popular entry view.
  const lastVideoSearchPath = useRef('/popular')
  useEffect(() => {
    if (
      location.pathname === '/popular' ||
      location.pathname === '/video-search'
    ) {
      lastVideoSearchPath.current = location.pathname + location.search
    }
  }, [location.pathname, location.search])

  const groups: MenuGroup[] = [
    {
      id: 'search',
      items: [
        {
          path: '/popular',
          icon: Search,
          label: t('nav.videoSearch'),
          ariaLabel: t('nav.aria.videoSearch'),
          requiresAuth: false,
        },
        {
          path: '/search',
          icon: Link,
          label: t('nav.search'),
          ariaLabel: t('nav.aria.search'),
          requiresAuth: false,
        },
        {
          path: '/downloads',
          icon: DownloadIcon,
          label: t('nav.downloads'),
          ariaLabel: t('nav.aria.downloads'),
          requiresAuth: false,
        },
      ],
    },
    {
      id: 'bilibili',
      label: t('nav.category.bilibili'),
      items: [
        {
          path: '/favorite',
          icon: Star,
          label: t('nav.favorite'),
          ariaLabel: t('nav.aria.favorite'),
          requiresAuth: true,
        },
        {
          path: '/watch-history',
          icon: Eye,
          label: t('nav.watchHistory'),
          ariaLabel: t('nav.aria.watchHistory'),
          requiresAuth: true,
        },
      ],
    },
    {
      id: 'tool',
      label: t('nav.category.tool'),
      items: [
        {
          path: '/trim',
          icon: Scissors,
          label: t('nav.trim'),
          ariaLabel: t('nav.aria.trim'),
          requiresAuth: false,
        },
        {
          path: '/concat',
          icon: Combine,
          label: t('nav.concat'),
          ariaLabel: t('nav.aria.concat'),
          requiresAuth: false,
        },
        {
          path: '/audio',
          icon: Music,
          label: t('nav.audio'),
          ariaLabel: t('nav.aria.audio'),
          requiresAuth: false,
        },
        {
          path: '/resolution',
          icon: Scaling,
          label: t('nav.resolution'),
          ariaLabel: t('nav.aria.resolution'),
          requiresAuth: false,
        },
        {
          path: '/rotation',
          icon: RotateCw,
          label: t('nav.rotation'),
          ariaLabel: t('nav.aria.rotation'),
          requiresAuth: false,
        },
        {
          path: '/gif',
          icon: ImagePlay,
          label: t('nav.gif'),
          ariaLabel: t('nav.aria.gif'),
          requiresAuth: false,
        },
      ],
    },
  ]

  const renderItem = (item: MenuItem) => {
    const Icon = item.icon
    // Why the /video-search special case: the 動画検索 item targets the
    // /popular entry view, but /video-search is the same feature's results
    // page — it must keep the item active instead of deselecting it.
    const isActive =
      location.pathname === item.path ||
      (item.path === '/popular' && location.pathname === '/video-search')
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
     * For the Home item, navigates with the last viewed `?page` parameter
     * restored from Redux state, so the sidebar Home button returns the
     * user to the pagination page they were on (rather than page 1).
     * The `?page` param is always set (even for page 1) so it takes
     * URL resolution priority over any stale `?p` embedded in `input.url`.
     *
     * For other items, performs a plain path navigation.
     * Disabled items (auth required but not logged in) are no-ops.
     */
    const handleClick = () => {
      if (isDisabled || isActive) return
      if (isSearch) {
        navigate({ pathname: '/search', search: `?page=${homePage}` })
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
