/**
 * Page registry: every routable page as one feature entry. Single source
 * shared by the persistent layout (mount table + valid-path checks), the
 * sidebar (nav groups), and the Settings page (startup-page options and
 * the page-visibility toggles).
 */
import { AudioContent } from '@/pages/audio'
import { ConcatContent } from '@/pages/concat'
import { DownloadsContent } from '@/pages/downloads'
import { FavoriteContent } from '@/pages/favorite'
import { GifContent } from '@/pages/gif'
import { HistoryContent } from '@/pages/history'
import { PopularContent } from '@/pages/popular'
import { ResolutionContent } from '@/pages/resolution'
import { RotationContent } from '@/pages/rotation'
import { SearchContent } from '@/pages/search'
import { SettingsContent } from '@/pages/settings'
import { TrimContent } from '@/pages/trim'
import { VideoSearchContent } from '@/pages/video-search'
import { WatchHistoryContent } from '@/pages/watch-history'
import type { LucideIcon } from 'lucide-react'
import {
  Archive,
  Combine,
  Download as DownloadIcon,
  Eye,
  ImagePlay,
  Link,
  Music,
  RotateCw,
  Scaling,
  Scissors,
  Search,
  Star,
} from 'lucide-react'
import type { FC } from 'react'

/** Sidebar nav group ids (a group with no visible items hides itself). */
export type NavGroupId = 'find' | 'download' | 'tool'

/** Sidebar group order and labels. */
export const NAV_GROUPS: readonly {
  id: NavGroupId
  labelKey: string
}[] = [
  { id: 'find', labelKey: 'nav.category.find' },
  { id: 'download', labelKey: 'nav.category.download' },
  { id: 'tool', labelKey: 'nav.category.tool' },
]

/** One routable path and the component mounted there. */
export interface PageRoute {
  readonly path: string
  readonly Component: FC
}

/**
 * A page feature as one registry entry.
 *
 * `routes[0].path` is the entry path: the sidebar nav target and the key
 * stored in the settings `disabledPages` list. Secondary routes (e.g.
 * /video-search, the results view of the 動画検索 feature) share the
 * entry's enabled/disabled state.
 */
export interface PageDef {
  readonly routes: readonly PageRoute[]
  /** i18n key for the sidebar and Settings labels. */
  readonly labelKey: string
  /** i18n key for the nav item's accessible name. */
  readonly ariaKey?: string
  readonly icon?: LucideIcon
  readonly groupId?: NavGroupId
  readonly requiresAuth?: boolean
  /** Stable hook for E2E selectors; i18n-proof unlike ariaKey. */
  readonly testId?: string
  /**
   * Core pages the user cannot hide: /search and /downloads carry the
   * download flow, /settings is the re-enable entry point.
   */
  readonly required?: boolean
}

export const PAGE_DEFS: readonly PageDef[] = [
  {
    routes: [
      { path: '/popular', Component: PopularContent },
      { path: '/video-search', Component: VideoSearchContent },
    ],
    labelKey: 'nav.videoSearch',
    ariaKey: 'nav.aria.videoSearch',
    icon: Search,
    groupId: 'find',
    testId: 'nav-popular',
  },
  {
    routes: [{ path: '/search', Component: SearchContent }],
    labelKey: 'nav.search',
    ariaKey: 'nav.aria.search',
    icon: Link,
    groupId: 'find',
    testId: 'nav-search',
    required: true,
  },
  {
    routes: [{ path: '/downloads', Component: DownloadsContent }],
    labelKey: 'nav.downloads',
    ariaKey: 'nav.aria.downloads',
    icon: DownloadIcon,
    groupId: 'download',
    testId: 'nav-downloads',
    required: true,
  },
  {
    routes: [{ path: '/history', Component: HistoryContent }],
    labelKey: 'nav.downloadHistory',
    ariaKey: 'nav.aria.downloadHistory',
    icon: Archive,
    groupId: 'download',
    testId: 'nav-history',
  },
  {
    routes: [{ path: '/favorite', Component: FavoriteContent }],
    labelKey: 'nav.favorite',
    ariaKey: 'nav.aria.favorite',
    icon: Star,
    groupId: 'find',
    requiresAuth: true,
  },
  {
    routes: [{ path: '/watch-history', Component: WatchHistoryContent }],
    labelKey: 'nav.watchHistory',
    ariaKey: 'nav.aria.watchHistory',
    icon: Eye,
    groupId: 'find',
    requiresAuth: true,
  },
  {
    routes: [{ path: '/trim', Component: TrimContent }],
    labelKey: 'nav.trim',
    ariaKey: 'nav.aria.trim',
    icon: Scissors,
    groupId: 'tool',
  },
  {
    routes: [{ path: '/concat', Component: ConcatContent }],
    labelKey: 'nav.concat',
    ariaKey: 'nav.aria.concat',
    icon: Combine,
    groupId: 'tool',
  },
  {
    routes: [{ path: '/audio', Component: AudioContent }],
    labelKey: 'nav.audio',
    ariaKey: 'nav.aria.audio',
    icon: Music,
    groupId: 'tool',
  },
  {
    routes: [{ path: '/resolution', Component: ResolutionContent }],
    labelKey: 'nav.resolution',
    ariaKey: 'nav.aria.resolution',
    icon: Scaling,
    groupId: 'tool',
  },
  {
    routes: [{ path: '/rotation', Component: RotationContent }],
    labelKey: 'nav.rotation',
    ariaKey: 'nav.aria.rotation',
    icon: RotateCw,
    groupId: 'tool',
  },
  {
    routes: [{ path: '/gif', Component: GifContent }],
    labelKey: 'nav.gif',
    ariaKey: 'nav.aria.gif',
    icon: ImagePlay,
    groupId: 'tool',
  },
  {
    routes: [{ path: '/settings', Component: SettingsContent }],
    labelKey: 'settings.title',
    required: true,
  },
]

/** Every route in registry order — the persistent layout mount table. */
export const PAGE_ROUTES: readonly PageRoute[] = PAGE_DEFS.flatMap(
  (def) => def.routes,
)

/**
 * Every routable page path, in registry (sidebar) order. Single source
 * shared by the persistent layout (valid navigation targets), the
 * startup-page redirect validation, and the Settings startup-page
 * options.
 */
export const PAGE_PATHS: readonly string[] = PAGE_ROUTES.map(
  (route) => route.path,
)

/** Pages the user may hide via the Settings page-visibility toggles. */
export const TOGGLEABLE_PAGES: readonly PageDef[] = PAGE_DEFS.filter(
  (def) => !def.required,
)

/** The entry path of a page definition (`disabledPages` key). */
export function pageKey(def: PageDef): string {
  return def.routes[0].path
}

/** The registry entry owning a route path, if any. */
export function pageDefForPath(pathname: string): PageDef | undefined {
  return PAGE_DEFS.find((def) => def.routes.some((r) => r.path === pathname))
}

/**
 * Whether a page entry is currently visible. Required pages are always
 * enabled; others are disabled when their entry path is listed in the
 * `disabledPages` setting.
 */
export function isPageEnabled(
  def: PageDef,
  disabledPages: readonly string[] | undefined,
): boolean {
  return def.required === true || !disabledPages?.includes(pageKey(def))
}

/** Whether a route path belongs to an enabled page. */
export function isPathEnabled(
  pathname: string,
  disabledPages: readonly string[] | undefined,
): boolean {
  const def = pageDefForPath(pathname)
  return def !== undefined && isPageEnabled(def, disabledPages)
}
