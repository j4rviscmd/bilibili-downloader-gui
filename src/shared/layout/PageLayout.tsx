import { DownloadStatusDialog } from '@/features/download-status'
import { useSettings } from '@/features/settings'
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
import { Archive, PanelLeft, PanelLeftClose } from 'lucide-react'
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
 * Props for PageLayoutShell component.
 */
export interface PageLayoutShellProps {
  /** Page content to render (directly in SidebarInset) */
  children: ReactNode
}

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

/**
 * Page layout shell component with sidebar and app bar.
 *
 * Provides the common layout structure including:
 * - Collapsible sidebar with navigation
 * - App bar with user info and theme toggle
 * - Settings dialog
 *
 * Children are rendered directly in the SidebarInset without any wrapper,
 * giving full control over the content layout to the parent.
 *
 * @example
 * ```tsx
 * <PageLayoutShell>
 *   <YourPageContent />
 * </PageLayoutShell>
 * ```
 */
export function PageLayoutShell({ children }: PageLayoutShellProps) {
  const { user } = useUser()
  const { settings, saveByForm } = useSettings()
  const theme = settings.theme ?? 'light'
  const setTheme = (t: 'light' | 'dark') => {
    saveByForm({ ...settings, theme: t }, true)
  }
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

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
                  <Archive className="size-4" />
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
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
      <DownloadStatusDialog />
      <SettingsDialog />
    </>
  )
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
 * This is a convenience wrapper around PageLayoutShell that provides
 * common content styling. For more control, use PageLayoutShell directly.
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
export function PageLayout({
  children,
  withScrollArea = true,
  innerClassName,
}: PageLayoutProps) {
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
    <PageLayoutShell>
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
    </PageLayoutShell>
  )
}
