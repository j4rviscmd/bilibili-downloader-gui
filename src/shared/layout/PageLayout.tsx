import { useSettings } from '@/features/settings'
import { useUser } from '@/features/user'
import { Settings } from '@/shared/animate-ui/icons/settings'
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
  SidebarSeparator,
  useSidebar,
} from '@/shared/animate-ui/radix/sidebar'
import { QueueBottomBar } from '@/shared/queue/ui/QueueBottomBar'
import { ThumbnailFlightLayer } from '@/shared/queue/ui/ThumbnailFlightLayer'
import AppBar from '@/shared/ui/AppBar/AppBar'
import { HistoryNavigation } from '@/shared/ui/AppBar/HistoryNavigation'
import { NavigationSidebarHeader } from '@/shared/ui/NavigationSidebar'
import { Archive, ChevronsLeft, ChevronsRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'

/**
 * Props for PageLayoutShell component.
 */
export interface PageLayoutShellProps {
  /** Page content to render (directly in SidebarInset) */
  children: ReactNode
}

/**
 * Sidebar expand/collapse toggle rendered at the bottom of the sidebar
 * footer, below a divider (Google Cloud Console docs style).
 *
 * Why: the toggle used to live in the app bar next to the back/forward
 * navigation (issue #692), which made the three icon buttons easy to
 * mis-tap. Placing it inside the sidebar keeps the two controls apart.
 */
function SidebarToggleButton() {
  const { state, toggleSidebar } = useSidebar()
  const { t } = useTranslation()

  const isExpanded = state === 'expanded'
  const label = isExpanded
    ? t('nav.aria.closeSidebar') || 'Close sidebar'
    : t('nav.aria.openSidebar') || 'Open sidebar'
  const Icon = isExpanded ? ChevronsLeft : ChevronsRight

  return (
    <SidebarMenuButton
      onClick={toggleSidebar}
      tooltip={label}
      aria-label={label}
    >
      <Icon className="size-4" />
      <span>{label}</span>
    </SidebarMenuButton>
  )
}

/**
 * Page layout shell component with sidebar and app bar.
 *
 * Provides the common layout structure including:
 * - Collapsible sidebar with navigation (incl. the settings page link)
 * - App bar with user info and theme toggle
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
    saveByForm({ theme: t }, true)
  }
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <>
      {/*
        CONSTRAINT: Bound the app shell to viewport height so the flex chain
        (SidebarInset -> h-full wrappers -> flex-1 min-h-0 scroll regions)
        resolves to definite heights. The sidebar primitive defaults to
        `min-h-svh` (a floor, not a definite height); without this override,
        growing content makes the wrapper exceed 100svh and `#root`'s
        `overflow:hidden` (global.css) clips it, so page-level
        `overflow-y-auto` regions never trigger (issue #461).
      */}
      <SidebarProvider defaultOpen={true} className="h-svh min-h-0">
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
                <SidebarMenuButton
                  isActive={location.pathname === '/settings'}
                  tooltip={t('settings.title')}
                  onClick={() => navigate('/settings')}
                  aria-label={t('settings.title')}
                >
                  <Settings className="size-4" />
                  <span>{t('settings.title')}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <SidebarSeparator className="mx-0 my-1" />
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarToggleButton />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>
        <SidebarInset>
          <div className="flex h-full w-full flex-col">
            <header className="bg-accent flex shadow-md">
              <HistoryNavigation />
              <AppBar user={user} theme={theme} setTheme={setTheme} />
            </header>
            {children}
            {/* Queue bottom bar (issue #691): common layout element, mounts
                after page content on every page and never unmounts. The
                flight layer renders the fly-to-bar thumbnails above it. */}
            <QueueBottomBar />
            <ThumbnailFlightLayer />
          </div>
        </SidebarInset>
      </SidebarProvider>
    </>
  )
}
