import { useSelector } from '@/app/store'
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
import { Eye, Home, Combine, Scissors, Star } from 'lucide-react'
import { Fragment } from 'react'
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

  const groups: MenuGroup[] = [
    {
      id: 'home',
      items: [
        {
          path: '/home',
          icon: Home,
          label: t('nav.home'),
          ariaLabel: t('nav.aria.home'),
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
      ],
    },
  ]

  const renderItem = (item: MenuItem) => {
    const Icon = item.icon
    const isActive = location.pathname === item.path
    const isDisabled = item.requiresAuth && !isLoggedIn
    const isHome = item.path === '/home'

    const button = (
      <SidebarMenuButton
        isActive={isActive}
        tooltip={isDisabled ? undefined : item.label}
        onClick={() => !isDisabled && navigate(item.path)}
        aria-label={item.ariaLabel}
        aria-current={isActive ? 'page' : undefined}
        aria-disabled={isDisabled || undefined}
        className={isDisabled ? 'cursor-not-allowed opacity-50' : undefined}
      >
        {isHome && hasActiveDownloads ? (
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
        className={cn('flex flex-col px-2', className)}
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
