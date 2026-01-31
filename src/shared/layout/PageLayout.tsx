import { useTheme } from '@/app/providers/ThemeContext'
import { useUser } from '@/features/user'
import OpenSettingsDialogButton from '@/features/settings/dialog/OpenSettingsDialogButton'
import SettingsDialog from '@/features/settings/dialog/SettingsDialog'
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
} from '@/shared/animate-ui/radix/sidebar'
import AppBar from '@/shared/ui/AppBar/AppBar'
import { NavigationSidebarHeader } from '@/shared/ui/NavigationSidebar'
import { cn } from '@/shared/lib/utils'
import type { ReactNode } from 'react'
import { ScrollArea, ScrollBar } from '@/shared/ui/scroll-area'

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
        innerClassName
      )}
    >
      {children}
    </div>
  )

  const scrollableContent = withScrollArea ? (
    <ScrollArea
      style={{
        height: 'calc(100dvh - 2.3rem)',
      }}
      className="flex w-full"
    >
      {content}
      <ScrollBar />
    </ScrollArea>
  ) : (
    content
  )

  return (
    <>
      <SidebarProvider defaultOpen={false}>
        <Sidebar>
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
            <header className="bg-accent flex">
              <SidebarTrigger
                size="lg"
                className="h-full shrink-0 cursor-pointer shadow-md"
              />
              <AppBar user={user} theme={theme} setTheme={setTheme} />
            </header>
            {scrollableContent}
          </div>
        </SidebarInset>
      </SidebarProvider>
      <SettingsDialog />
    </>
  )
}
