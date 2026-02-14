import { useSelector } from '@/app/store'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/shared/animate-ui/radix/sidebar'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { cn } from '@/shared/lib/utils'
import { Eye, Home, Star } from 'lucide-react'
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
 * - Favorite (/favorite) - Favorite videos (requires login)
 * - Watch History (/watch-history) - Bilibili watch history
 *   (requires login)
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

  const currentPath = location.pathname

  const menuItems = [
    {
      path: '/home',
      icon: Home,
      label: t('nav.home'),
      ariaLabel: t('nav.aria.home'),
      requiresAuth: false,
    },
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
  ]

  return (
    <TooltipProvider>
      <nav
        aria-label={t('nav.aria.mainNavigation')}
        className={cn('flex flex-col gap-2 p-2', className)}
      >
        <SidebarMenu>
          {menuItems.map((item) => {
            const Icon = item.icon
            const isActive = currentPath === item.path
            const isDisabled = item.requiresAuth && !isLoggedIn

            const button = (
              <SidebarMenuButton
                isActive={isActive}
                tooltip={isDisabled ? undefined : item.label}
                onClick={() => !isDisabled && navigate(item.path)}
                aria-label={item.ariaLabel}
                aria-current={isActive ? 'page' : undefined}
                aria-disabled={isDisabled || undefined}
                className={
                  isDisabled ? 'cursor-not-allowed opacity-50' : undefined
                }
              >
                <Icon />
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
          })}
        </SidebarMenu>
      </nav>
    </TooltipProvider>
  )
}
