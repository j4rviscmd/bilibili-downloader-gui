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
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from '@/shared/animate-ui/radix/sidebar'
import { Button } from '@/shared/ui/button'
import { cn } from '@/shared/lib/utils'
import AppBar from '@/shared/ui/AppBar/AppBar'
import { NavigationSidebarHeader } from '@/shared/ui/NavigationSidebar'
import { ScrollArea, ScrollBar } from '@/shared/ui/scroll-area'
import { PanelLeft, PanelLeftClose, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'

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
 *
 * - Shows PanelLeft when collapsed, PanelLeftClose when expanded
 * - Includes aria-label for screen readers
 * - Includes tooltip for visual feedback
 */
function EnhancedSidebarTrigger({ className }: { className?: string }) {
  const { state, toggleSidebar } = useSidebar()
  const { t } = useTranslation()

  const isExpanded = state === 'expanded'
  const icon = isExpanded ? <PanelLeftClose /> : <PanelLeft />
  const label = isExpanded
    ? t('nav.aria.closeSidebar') || 'Close sidebar'
    : t('nav.aria.openSidebar') || 'Open sidebar'

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('h-full shrink-0 cursor-pointer', className)}
      onClick={toggleSidebar}
      aria-label={label}
      title={label}
    >
      {icon}
      <span className="sr-only">{label}</span>
    </Button>
  )
}

export function PageLayout({
  children,
  withScrollArea = true,
  innerClassName,
}: PageLayoutProps) {
  const { user } = useUser()
  const { theme, setTheme } = useTheme()

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

  const renderContent = () => {
    if (!withScrollArea) return content

    return (
      <ScrollArea
        style={{ height: 'calc(100dvh - 2.3rem)' }}
        className="flex w-full"
      >
        {content}
        <ScrollBar />
      </ScrollArea>
    )
  }

  return (
    <>
      <SidebarProvider defaultOpen={true}>
        <Sidebar collapsible="icon">
          <NavigationSidebarHeader />
          <SidebarContent />
          <SidebarFooter>
            <SidebarMenu>
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
            {renderContent()}
          </div>
        </SidebarInset>
      </SidebarProvider>
      <SettingsDialog />
    </>
  )
}
