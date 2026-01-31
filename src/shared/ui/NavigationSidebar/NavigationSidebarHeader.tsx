import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/shared/animate-ui/radix/sidebar'
import { cn } from '@/shared/lib/utils'
import { Clock, Home } from 'lucide-react'
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
 *
 * Highlights the current page with active state styling.
 */
export function NavigationSidebarHeader({
  className,
}: NavigationSidebarHeaderProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  const currentPath = location.pathname

  const menuItems = [
    {
      path: '/home',
      icon: Home,
      label: t('nav.home'),
      ariaLabel: t('nav.aria.home'),
    },
    {
      path: '/history',
      icon: Clock,
      label: t('nav.history'),
      ariaLabel: t('nav.aria.history'),
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
                tooltip={item.label}
                onClick={() => navigate(item.path)}
                aria-label={item.ariaLabel}
                aria-current={isActive ? 'page' : undefined}
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
