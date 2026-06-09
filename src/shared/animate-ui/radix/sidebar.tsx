'use client'

import { invoke } from '@tauri-apps/api/core'
import { type VariantProps, cva } from 'class-variance-authority'
import { PanelLeftIcon } from 'lucide-react'
import { type Transition } from 'motion/react'
import { Slot } from 'radix-ui'
import * as React from 'react'

import { useAppDispatch, useSelector } from '@/app/store'
import { setSidebarOpen } from '@/features/sidebar'
import {
  MotionHighlight,
  MotionHighlightItem,
} from '@/shared/animate-ui/effects/motion-highlight'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/shared/animate-ui/radix/tooltip'
import { logger } from '@/shared/lib/logger'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Separator } from '@/shared/ui/separator'
import { Skeleton } from '@/shared/ui/skeleton'
import { useTranslation } from 'react-i18next'

const SIDEBAR_WIDTH = '16rem'
const SIDEBAR_WIDTH_ICON = '3rem'
const SIDEBAR_KEYBOARD_SHORTCUT = 'b'

type Settings = {
  dlOutputPath?: string
  language: string
  libPath?: string
  sidebarExpanded?: boolean
}

/**
 * Sidebar context property types
 *
 * Type definition for context values provided by SidebarProvider.
 */
type SidebarContextProps = {
  /** Current state of the sidebar */
  state: 'expanded' | 'collapsed'
  /** Whether the sidebar is open in desktop view */
  open: boolean
  /** Function to set the sidebar open/close state */
  setOpen: (open: boolean) => void
  /** Function to toggle the sidebar open/close state */
  toggleSidebar: () => void
  /** Whether initial render is complete (transitions disabled until true) */
  isHydrated: boolean
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null)

/**
 * Hook for using the sidebar context
 *
 * Used within SidebarProvider to get sidebar state and action functions.
 *
 * @throws Error if used outside of SidebarProvider
 * @returns Sidebar context value
 *
 * @example
 * ```tsx
 * const { open, toggleSidebar } = useSidebar()
 * ```
 */
function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider.')
  }
  return context
}

/**
 * SidebarProvider property types
 */
type SidebarProviderProps = React.ComponentProps<'div'> & {
  /** Default open/close state */
  defaultOpen?: boolean
  /** Open/close state in controlled mode (uses Redux state when omitted) */
  open?: boolean
  /** Callback on open/close state change */
  onOpenChange?: (open: boolean) => void
}

/**
 * Sidebar context provider
 *
 * Manages sidebar state and provides context to child components.
 * Syncs with both Redux and settings.json to maintain state across page navigations.
 *
 * Features:
 * - Read initial state from Redux (preloaded during init)
 * - Persist state changes to settings.json
 * - Keyboard shortcut support (Cmd/Ctrl + B)
 *
 * @example
 * ```tsx
 * <SidebarProvider>
 *   <Sidebar />
 *   <SidebarInset />
 * </SidebarProvider>
 * ```
 */
function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: SidebarProviderProps) {
  const dispatch = useAppDispatch()
  const [fallbackOpen] = React.useState(defaultOpen)
  const [cachedSettings, setCachedSettings] = React.useState<Settings | null>(
    null,
  )
  const [isHydrated, setIsHydrated] = React.useState(false)

  React.useEffect(() => {
    const id = requestAnimationFrame(() => setIsHydrated(true))
    return () => cancelAnimationFrame(id)
  }, [])

  // Use Redux state via selector (controlled mode uses openProp if provided)
  // Initial state is preloaded during init sequence in useInit.tsx
  const reduxOpen = useSelector((state) => state.sidebar.sidebarOpen)
  const open = openProp ?? reduxOpen ?? fallbackOpen

  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === 'function' ? value(open) : value
      if (setOpenProp) {
        setOpenProp(openState)
      } else {
        dispatch(setSidebarOpen(openState))
      }

      // Persist to settings.json
      const persist = async () => {
        try {
          const current =
            cachedSettings ?? ((await invoke('get_settings')) as Settings)
          const updatedSettings = {
            ...current,
            sidebarExpanded: openState,
          }
          setCachedSettings(updatedSettings)
          await invoke('set_settings', { settings: updatedSettings })
        } catch (error) {
          logger.error('Failed to save sidebar state to settings', error)
        }
      }
      persist()
    },
    [dispatch, open, setOpenProp, cachedSettings],
  )

  const toggleSidebar = React.useCallback(() => {
    return setOpen((open) => !open)
  }, [setOpen])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === SIDEBAR_KEYBOARD_SHORTCUT &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault()
        toggleSidebar()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [toggleSidebar])

  const state = open ? 'expanded' : 'collapsed'

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      state,
      open,
      setOpen,
      toggleSidebar,
      isHydrated,
    }),
    [state, open, setOpen, toggleSidebar, isHydrated],
  )

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipProvider delayDuration={0}>
        <div
          data-slot="sidebar-wrapper"
          style={
            {
              '--sidebar-width': SIDEBAR_WIDTH,
              '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
              ...style,
            } as React.CSSProperties
          }
          className={cn(
            'group/sidebar-wrapper has-data-[variant=inset]:bg-sidebar flex min-h-svh w-full',
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </TooltipProvider>
    </SidebarContext.Provider>
  )
}

/**
 * Sidebar component property types
 */
type SidebarProps = React.ComponentProps<'div'> & {
  /** Sidebar placement position */
  side?: 'left' | 'right'
  /** Sidebar display style */
  variant?: 'sidebar' | 'floating' | 'inset'
  /** Collapse behavior mode */
  collapsible?: 'offcanvas' | 'icon' | 'none'
  /** Additional class names for the container */
  containerClassName?: string
  /** Whether to enable hover animation */
  animateOnHover?: boolean
  /** Animation transition settings */
  transition?: Transition
}

/**
 * Main sidebar component
 *
 * A sidebar that supports different display modes for desktop and mobile.
 *
 * Display modes:
 * - Desktop: collapsible='offcanvas' slides off-screen, 'icon' shows icons only
 * - Mobile: Overlay display using Sheet component
 *
 * @example
 * ```tsx
 * <Sidebar>
 *   <SidebarHeader />
 *   <SidebarContent />
 *   <SidebarFooter />
 * </Sidebar>
 * ```
 */
function Sidebar({
  side = 'left',
  variant = 'sidebar',
  collapsible = 'offcanvas',
  className,
  children,
  animateOnHover = true,
  containerClassName,
  transition = { type: 'spring', stiffness: 350, damping: 35 },
  ...props
}: SidebarProps) {
  const { state, isHydrated } = useSidebar()

  if (collapsible === 'none') {
    return (
      <MotionHighlight
        enabled={animateOnHover}
        hover
        controlledItems
        mode="parent"
        containerClassName={containerClassName}
        transition={transition}
      >
        <div
          data-slot="sidebar"
          className={cn(
            'bg-sidebar text-sidebar-foreground flex h-full w-(--sidebar-width) flex-col',
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </MotionHighlight>
    )
  }

  return (
    <div
      className="group peer text-sidebar-foreground hidden md:block"
      data-state={state}
      data-collapsible={state === 'collapsed' ? collapsible : ''}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      <div
        data-slot="sidebar-gap"
        className={cn(
          'relative w-(--sidebar-width) bg-transparent',
          isHydrated &&
            'transition-[width] duration-400 ease-[cubic-bezier(0.7,-0.15,0.25,1.15)]',
          'group-data-[collapsible=offcanvas]:w-0',
          'group-data-[side=right]:rotate-180',
          variant === 'floating' || variant === 'inset'
            ? 'group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]'
            : 'group-data-[collapsible=icon]:w-(--sidebar-width-icon)',
        )}
      />
      <div
        data-slot="sidebar-container"
        className={cn(
          'fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) md:flex',
          isHydrated &&
            'transition-[left,right,width] duration-400 ease-[cubic-bezier(0.75,0,0.25,1)]',
          side === 'left'
            ? 'left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]'
            : 'right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]',
          variant === 'floating' || variant === 'inset'
            ? 'p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]'
            : 'group-data-[collapsible=icon]:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l',
          className,
        )}
        {...props}
      >
        <MotionHighlight
          containerClassName={cn('size-full', containerClassName)}
          enabled={animateOnHover}
          hover
          controlledItems
          mode="parent"
          forceUpdateBounds
          transition={transition}
        >
          <div
            data-sidebar="sidebar"
            data-slot="sidebar-inner"
            className="bg-sidebar group-data-[variant=floating]:border-sidebar-border flex size-full flex-col group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:shadow-sm"
          >
            {children}
          </div>
        </MotionHighlight>
      </div>
    </div>
  )
}

/**
 * SidebarTrigger property types
 */
type SidebarTriggerProps = React.ComponentProps<typeof Button>

/**
 * Sidebar toggle trigger button
 *
 * A button component that toggles the sidebar open/close on click.
 * Typically placed in the AppBar.
 *
 * @example
 * ```tsx
 * <SidebarTrigger />
 * ```
 */
function SidebarTrigger({ className, onClick, ...props }: SidebarTriggerProps) {
  const { toggleSidebar } = useSidebar()

  return (
    <Button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      className={cn('size-7', className)}
      onClick={(event) => {
        onClick?.(event)
        toggleSidebar()
      }}
      {...props}
    >
      <PanelLeftIcon />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  )
}

/**
 * SidebarRail property types
 */
type SidebarRailProps = React.ComponentProps<'button'>

/**
 * Sidebar rail (hover area)
 *
 * An invisible hover area placed at the edge of the sidebar.
 * Allows toggling the sidebar via click or drag when hovered.
 */
function SidebarRail({ className, ...props }: SidebarRailProps) {
  const { toggleSidebar } = useSidebar()
  const { t } = useTranslation()

  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label={t('nav.aria.toggleSidebar')}
      tabIndex={-1}
      onClick={toggleSidebar}
      title={t('nav.aria.toggleSidebar')}
      className={cn(
        'hover:after:bg-sidebar-border absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] sm:flex',
        'in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize',
        '[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize',
        'hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full',
        '[[data-side=left][data-collapsible=offcanvas]_&]:-right-2',
        '[[data-side=right][data-collapsible=offcanvas]_&]:-left-2',
        className,
      )}
      {...props}
    />
  )
}

/**
 * SidebarInset property types
 */
type SidebarInsetProps = React.ComponentProps<'main'>

/**
 * Main content area of the sidebar
 *
 * Displays the main content adjacent to the sidebar.
 * Special styles are applied when variant='inset'.
 */
function SidebarInset({ className, ...props }: SidebarInsetProps) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        'bg-background relative flex w-full flex-1 flex-col',
        'md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ml-2',
        className,
      )}
      {...props}
    />
  )
}

/**
 * SidebarInput property types
 */
type SidebarInputProps = React.ComponentProps<typeof Input>

/**
 * Sidebar input component
 *
 * An input field optimized for use within the sidebar.
 */
function SidebarInput({ className, ...props }: SidebarInputProps) {
  return (
    <Input
      data-slot="sidebar-input"
      data-sidebar="input"
      className={cn('bg-background h-8 w-full shadow-none', className)}
      {...props}
    />
  )
}

/**
 * SidebarHeader property types
 */
type SidebarHeaderProps = React.ComponentProps<'div'>

/**
 * Sidebar header area
 *
 * A container for header content placed at the top of the sidebar.
 */
function SidebarHeader({ className, ...props }: SidebarHeaderProps) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={cn('flex flex-col gap-2 p-2', className)}
      {...props}
    />
  )
}

/**
 * SidebarFooter property types
 */
type SidebarFooterProps = React.ComponentProps<'div'>

/**
 * Sidebar footer area
 *
 * A container for footer content placed at the bottom of the sidebar.
 */
function SidebarFooter({ className, ...props }: SidebarFooterProps) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={cn('flex flex-col gap-2 p-2', className)}
      {...props}
    />
  )
}

/**
 * SidebarSeparator property types
 */
type SidebarSeparatorProps = React.ComponentProps<typeof Separator>

/**
 * Divider within the sidebar
 */
function SidebarSeparator({ className, ...props }: SidebarSeparatorProps) {
  return (
    <Separator
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={cn('bg-sidebar-border mx-2 w-auto', className)}
      {...props}
    />
  )
}

/**
 * SidebarContent property types
 */
type SidebarContentProps = React.ComponentProps<'div'>

/**
 * Sidebar content area
 *
 * Displays the scrollable main content.
 */
function SidebarContent({ className, ...props }: SidebarContentProps) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden',
        className,
      )}
      {...props}
    />
  )
}

/**
 * SidebarGroup property types
 */
type SidebarGroupProps = React.ComponentProps<'div'>

/**
 * Sidebar group
 *
 * A container for grouping related menu items.
 */
function SidebarGroup({ className, ...props }: SidebarGroupProps) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={cn('relative flex w-full min-w-0 flex-col p-2', className)}
      {...props}
    />
  )
}

/**
 * SidebarGroupLabel property types
 */
type SidebarGroupLabelProps = React.ComponentProps<'div'> & {
  asChild?: boolean
}

/**
 * Sidebar group label
 *
 * Displays the group title. Hidden when in icon mode.
 */
function SidebarGroupLabel({
  className,
  asChild = false,
  ...props
}: SidebarGroupLabelProps) {
  const Comp = asChild ? Slot.Root : 'div'

  return (
    <Comp
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={cn(
        'text-sidebar-foreground/70 ring-sidebar-ring flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium outline-hidden transition-[margin,opacity] duration-300 ease-linear group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0 focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0',
        className,
      )}
      {...props}
    />
  )
}

/**
 * SidebarGroupAction property types
 */
type SidebarGroupActionProps = React.ComponentProps<'button'> & {
  asChild?: boolean
}

/**
 * Sidebar group action button
 *
 * An action button placed at the top-right of the group.
 */
function SidebarGroupAction({
  className,
  asChild = false,
  ...props
}: SidebarGroupActionProps) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="sidebar-group-action"
      data-sidebar="group-action"
      className={cn(
        'text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform group-data-[collapsible=icon]:hidden after:absolute after:-inset-2 focus-visible:ring-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0',
        className,
      )}
      {...props}
    />
  )
}

/**
 * SidebarGroupContent property types
 */
type SidebarGroupContentProps = React.ComponentProps<'div'>

/**
 * Sidebar group content
 *
 * A container for placing menu items within a group.
 */
function SidebarGroupContent({
  className,
  ...props
}: SidebarGroupContentProps) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={cn('w-full text-sm', className)}
      {...props}
    />
  )
}

/**
 * SidebarMenu property types
 */
type SidebarMenuProps = React.ComponentProps<'ul'>

/**
 * Sidebar menu list
 *
 * A container for displaying a list of menu items.
 */
function SidebarMenu({ className, ...props }: SidebarMenuProps) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={cn('flex w-full min-w-0 flex-col gap-1', className)}
      {...props}
    />
  )
}

/**
 * SidebarMenuItem property types
 */
type SidebarMenuItemProps = React.ComponentProps<'li'>

/**
 * Sidebar menu item
 *
 * A list element representing an individual menu item.
 */
function SidebarMenuItem({ className, ...props }: SidebarMenuItemProps) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn('group/menu-item relative', className)}
      {...props}
    />
  )
}

const sidebarMenuButtonActiveVariants = cva(
  'bg-sidebar-accent text-sidebar-accent-foreground rounded-md',
  {
    variants: {
      variant: {
        default: 'bg-sidebar-accent text-sidebar-accent-foreground',
        outline:
          'bg-sidebar-accent text-sidebar-accent-foreground shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

const sidebarMenuButtonVariants = cva(
  'peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] [&:not([data-highlight])]:hover:bg-sidebar-accent [&:not([data-highlight])]:hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-data-[sidebar=menu-action]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground [&:not([data-highlight])]:data-[state=open]:hover:bg-sidebar-accent [&:not([data-highlight])]:data-[state=open]:hover:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          '[&:not([data-highlight])]:hover:bg-sidebar-accent [&:not([data-highlight])]:hover:text-sidebar-accent-foreground',
        outline:
          'bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] [&:not([data-highlight])]:hover:bg-sidebar-accent [&:not([data-highlight])]:hover:text-sidebar-accent-foreground [&:not([data-highlight])]:hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]',
      },
      size: {
        default: 'h-8 text-sm',
        sm: 'h-7 text-xs',
        lg: 'h-12 text-sm group-data-[collapsible=icon]:p-0!',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

/**
 * SidebarMenuButton property types
 */
type SidebarMenuButtonProps = React.ComponentProps<'button'> & {
  asChild?: boolean
  isActive?: boolean
  tooltip?: string | React.ComponentProps<typeof TooltipContent>
} & VariantProps<typeof sidebarMenuButtonVariants>

/**
 * Sidebar menu button
 *
 * A button for menu items. Supports tooltip display and active state management.
 *
 * @example
 * ```tsx
 * <SidebarMenuButton asChild isActive>
 *   <a href="/dashboard">Dashboard</a>
 * </SidebarMenuButton>
 * ```
 */
function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = 'default',
  size = 'default',
  tooltip,
  className,
  ...props
}: SidebarMenuButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  const { state } = useSidebar()

  const button = (
    <MotionHighlightItem
      activeClassName={sidebarMenuButtonActiveVariants({ variant })}
    >
      <Comp
        data-slot="sidebar-menu-button"
        data-sidebar="menu-button"
        data-size={size}
        data-active={isActive}
        className={cn(sidebarMenuButtonVariants({ variant, size }), className)}
        {...props}
      />
    </MotionHighlightItem>
  )

  if (!tooltip) {
    return button
  }

  const tooltipContent =
    typeof tooltip === 'string' ? { children: tooltip } : tooltip

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        hidden={state !== 'collapsed'}
        {...tooltipContent}
      />
    </Tooltip>
  )
}

type SidebarMenuActionProps = React.ComponentProps<'button'> & {
  asChild?: boolean
  showOnHover?: boolean
}

/**
 * Sidebar menu action button
 *
 * An action button placed within a menu item.
 * When showOnHover is enabled, it is only visible on hover.
 */
function SidebarMenuAction({
  className,
  asChild = false,
  showOnHover = false,
  ...props
}: SidebarMenuActionProps) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot="sidebar-menu-action"
      data-sidebar="menu-action"
      className={cn(
        'text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground peer-hover/menu-button:text-sidebar-accent-foreground absolute top-1.5 right-1 z-[1] flex aspect-square w-5 items-center justify-center rounded-md p-0 outline-hidden transition-transform group-data-[collapsible=icon]:hidden peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 after:absolute after:-inset-2 focus-visible:ring-2 md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0',
        showOnHover &&
          'peer-data-[active=true]/menu-button:text-sidebar-accent-foreground group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 data-[state=open]:opacity-100 md:opacity-0',
        className,
      )}
      {...props}
    />
  )
}

/**
 * SidebarMenuBadge property types
 */
type SidebarMenuBadgeProps = React.ComponentProps<'div'>

/**
 * Sidebar menu badge
 *
 * A badge displayed on the right side of a menu item (e.g., notification count).
 */
function SidebarMenuBadge({ className, ...props }: SidebarMenuBadgeProps) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={cn(
        'text-sidebar-foreground peer-hover/menu-button:text-sidebar-accent-foreground peer-data-[active=true]/menu-button:text-sidebar-accent-foreground pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums select-none group-data-[collapsible=icon]:hidden peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1',
        className,
      )}
      {...props}
    />
  )
}

/**
 * SidebarMenuSkeleton property types
 */
type SidebarMenuSkeletonProps = React.ComponentProps<'div'> & {
  showIcon?: boolean
}

/**
 * Sidebar menu skeleton
 *
 * A placeholder displayed during loading.
 */
function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: SidebarMenuSkeletonProps) {
  const width = `${Math.floor(Math.random() * 40) + 50}%`

  return (
    <div
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={cn('flex h-8 items-center gap-2 rounded-md px-2', className)}
      {...props}
    >
      {showIcon && (
        <Skeleton
          className="size-4 rounded-md"
          data-sidebar="menu-skeleton-icon"
        />
      )}
      <Skeleton
        className="h-4 max-w-(--skeleton-width) flex-1"
        data-sidebar="menu-skeleton-text"
        style={
          {
            '--skeleton-width': width,
          } as React.CSSProperties
        }
      />
    </div>
  )
}

/**
 * SidebarMenuSub property types
 */
type SidebarMenuSubProps = React.ComponentProps<'ul'>

/**
 * Sidebar sub-menu list
 *
 * A list of nested sub-menu items.
 */
function SidebarMenuSub({ className, ...props }: SidebarMenuSubProps) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={cn(
        'border-sidebar-border mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l px-2.5 py-0.5',
        'group-data-[collapsible=icon]:hidden',
        className,
      )}
      {...props}
    />
  )
}

/**
 * SidebarMenuSubItem property types
 */
type SidebarMenuSubItemProps = React.ComponentProps<'li'>

/**
 * Sidebar sub-menu item
 *
 * An individual item within a sub-menu.
 */
function SidebarMenuSubItem({ className, ...props }: SidebarMenuSubItemProps) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={cn('group/menu-sub-item relative', className)}
      {...props}
    />
  )
}

/**
 * SidebarMenuSubButton property types
 */
type SidebarMenuSubButtonProps = React.ComponentProps<'a'> & {
  asChild?: boolean
  size?: 'sm' | 'md'
  isActive?: boolean
}

/**
 * Sidebar sub-menu button
 *
 * A button for sub-menu items.
 */
function SidebarMenuSubButton({
  asChild = false,
  size = 'md',
  isActive = false,
  className,
  ...props
}: SidebarMenuSubButtonProps) {
  const Comp = asChild ? Slot.Root : 'a'

  return (
    <MotionHighlightItem activeClassName="bg-sidebar-accent text-sidebar-accent-foreground rounded-md">
      <Comp
        data-slot="sidebar-menu-sub-button"
        data-sidebar="menu-sub-button"
        data-size={size}
        data-active={isActive}
        className={cn(
          'text-sidebar-foreground ring-sidebar-ring [&:not([data-highlight])]:hover:bg-sidebar-accent [&:not([data-highlight])]:hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground [&>svg]:text-sidebar-accent-foreground flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 outline-hidden focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
          'data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground',
          size === 'sm' && 'text-xs',
          size === 'md' && 'text-sm',
          'group-data-[collapsible=icon]:hidden',
          className,
        )}
        {...props}
      />
    </MotionHighlightItem>
  )
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
  type SidebarContentProps,
  type SidebarFooterProps,
  type SidebarGroupActionProps,
  type SidebarGroupContentProps,
  type SidebarGroupLabelProps,
  type SidebarGroupProps,
  type SidebarHeaderProps,
  type SidebarInputProps,
  type SidebarInsetProps,
  type SidebarMenuActionProps,
  type SidebarMenuBadgeProps,
  type SidebarMenuButtonProps,
  type SidebarMenuItemProps,
  type SidebarMenuProps,
  type SidebarMenuSkeletonProps,
  type SidebarMenuSubButtonProps,
  type SidebarMenuSubItemProps,
  type SidebarMenuSubProps,
  type SidebarProps,
  type SidebarProviderProps,
  type SidebarRailProps,
  type SidebarSeparatorProps,
  type SidebarTriggerProps,
}
