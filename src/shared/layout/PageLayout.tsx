import { useTheme } from '@/app/providers/ThemeContext'
import OpenSettingsDialogButton from '@/features/settings/dialog/OpenSettingsDialogButton'
import SettingsDialog from '@/features/settings/dialog/SettingsDialog'
import { useUser } from '@/features/user'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  useSidebar,
} from '@/shared/animate-ui/radix/sidebar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { cn } from '@/shared/lib/utils'
import AppBar from '@/shared/ui/AppBar/AppBar'
import { Button } from '@/shared/ui/button'
import { NavigationSidebarHeader } from '@/shared/ui/NavigationSidebar'
import { ScrollArea, ScrollBar } from '@/shared/ui/scroll-area'
import { Download, PanelLeft, PanelLeftClose } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'

/**
 * Props for PageLayout component.
 */
export interface PageLayoutProps {
  /** Page content to render */
  children: ReactNode
  /** Whether to wrap content in ScrollArea */
  withScrollArea?: boolean
  /** Additional className for the inner content wrapper */
  innerClassName?: string
}

/**
 * Standardized page layout component with sidebar navigation.
 *
 * Provides consistent layout structure across all pages including:
 * - Collapsible sidebar with navigation
 * - App bar with user info and theme toggle
 * - Optional scrollable content area
 * - Centered content with max-width constraint
 *
 * @example
 * ```tsx
 * // With scroll area (default)
 * <PageLayout>
 *   <YourPageContent />
 * </PageLayout>
 *
 * // Without scroll area
 * <PageLayout withScrollArea={false}>
 *   <YourPageContent />
 * </PageLayout>
 *
 * // With custom classes
 * <PageLayout
 *   withScrollArea={false}
 *   innerClassName="gap-6"
 * >
 *   <YourPageContent />
 * </PageLayout>
 * ```
 */

/**
 * Custom sidebar trigger with dynamic icon and accessibility improvements.
 */
function EnhancedSidebarTrigger({ className }: { className?: string }) {
  const { state, toggleSidebar } = useSidebar()
  const { t } = useTranslation()

  const isExpanded = state === 'expanded'
  const label = isExpanded
    ? t('nav.aria.closeSidebar') || 'Close sidebar'
    : t('nav.aria.openSidebar') || 'Open sidebar'
  const Icon = isExpanded ? PanelLeftClose : PanelLeft

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-full shrink-0 cursor-pointer', className)}
          onClick={toggleSidebar}
          aria-label={label}
        >
          <Icon />
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right" align="center">
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function PageLayout({
  children,
  withScrollArea = true,
  innerClassName,
}: PageLayoutProps) {
  const { user } = useUser()
  const { theme, setTheme } = useTheme()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  const content = (
    <div
      className={cn(
        'mx-auto flex w-full max-w-5xl flex-col gap-3 p-3 sm:px-6',
        innerClassName,
      )}
    >
      {children}
    </div>
  )

  return (
    <>
      <SidebarProvider defaultOpen={true}>
        <Sidebar collapsible="icon">
          <NavigationSidebarHeader />
          <SidebarContent />
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location.pathname === '/history'}
                  tooltip={t('nav.downloadHistory')}
                  onClick={() => navigate('/history')}
                  aria-label={t('nav.aria.downloadHistory')}
                >
                  <Download />
                  <span>{t('nav.downloadHistory')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <OpenSettingsDialogButton />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <div className="flex h-full w-full flex-col">
            <header className="bg-accent flex shadow-md">
              <EnhancedSidebarTrigger />
              <AppBar user={user} theme={theme} setTheme={setTheme} />
            </header>
            {withScrollArea ? (
              <ScrollArea
                style={{ height: 'calc(100dvh - 2.3rem)' }}
                className="flex w-full"
              >
                {content}
                <ScrollBar />
              </ScrollArea>
            ) : (
              content
            )}
          </div>
        </SidebarInset>
      </SidebarProvider>
      <SettingsDialog />
    </>
  )
}
