import { useSelector } from '@/app/store'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/shared/animate-ui/radix/sidebar'
import { cn } from '@/shared/lib/utils'
import { Clock, Home, Star } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'

type NavigationSidebarHeaderProps = {
  className?: string
}

/**
 * Navigation sidebar header with main menu items.
 *
 * Provides navigation to:
 * - Home (/home) - Video download interface
 * - History (/history) - Download history
 * - Favorite (/favorite) - Favorite videos (requires login)
 *
 * Highlights the current page with active state styling.
 * Disables favorite menu for non-logged-in users with tooltip.
 */
export function NavigationSidebarHeader({
  className,
}: NavigationSidebarHeaderProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  const user = useSelector((state) => state.user)
  const isLoggedIn = user.hasCookie && user.data?.isLogin

  const currentPath = location.pathname

  const menuItems = [
    {
      path: '/home',
      icon: Home,
      label: t('nav.home'),
      ariaLabel: t('nav.aria.home'),
      disabled: false,
      tooltip: undefined,
    },
    {
      path: '/history',
      icon: Clock,
      label: t('nav.history'),
      ariaLabel: t('nav.aria.history'),
      disabled: false,
      tooltip: undefined,
    },
    {
      path: '/favorite',
      icon: Star,
      label: t('nav.favorite'),
      ariaLabel: t('nav.aria.favorite'),
      disabled: !isLoggedIn,
      tooltip: !isLoggedIn ? t('nav.favoriteLoginRequired') : undefined,
    },
  ]

  return (
    <nav
      aria-label={t('nav.aria.mainNavigation')}
      className={cn('flex flex-col gap-2 p-2', className)}
    >
      <SidebarMenu>
        {menuItems.map((item) => {
          const Icon = item.icon
          const isActive = currentPath === item.path

          return (
            <SidebarMenuItem key={item.path}>
              <SidebarMenuButton
                isActive={isActive}
                tooltip={item.tooltip ?? item.label}
                onClick={() => !item.disabled && navigate(item.path)}
                aria-label={item.ariaLabel}
                aria-current={isActive ? 'page' : undefined}
                disabled={item.disabled}
              >
                <Icon />
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </nav>
  )
}
