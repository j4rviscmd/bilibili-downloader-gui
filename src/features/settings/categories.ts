import type { LucideIcon } from 'lucide-react'
import {
  Bell,
  CircleUser,
  Download,
  FlaskConical,
  FolderCog,
  Info,
  Settings,
  SlidersHorizontal,
} from 'lucide-react'

/** Category ids of the settings page (issue #398). */
export type SettingsCategoryId =
  | 'general'
  | 'download'
  | 'storage'
  | 'notifications'
  | 'toolDefaults'
  | 'account'
  | 'about'
  | 'dev'

export interface SettingsCategory {
  readonly id: SettingsCategoryId
  /** i18n key under `settings.category.*` */
  readonly labelKey: string
  readonly icon: LucideIcon
}

const DEV_CATEGORY: SettingsCategory = {
  id: 'dev',
  labelKey: 'settings.category.dev',
  icon: FlaskConical,
}

/**
 * Category registry of the settings page, rendered by CategoryNav.
 *
 * The dev category is compile-time filtered exactly like DevOptions
 * (`import.meta.env.DEV`); DevOptions keeps its own runtime guard as
 * belt-and-suspenders.
 */
export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  { id: 'general', labelKey: 'settings.category.general', icon: Settings },
  { id: 'download', labelKey: 'settings.category.download', icon: Download },
  { id: 'storage', labelKey: 'settings.category.storage', icon: FolderCog },
  {
    id: 'notifications',
    labelKey: 'settings.category.notifications',
    icon: Bell,
  },
  {
    id: 'toolDefaults',
    labelKey: 'settings.category.toolDefaults',
    icon: SlidersHorizontal,
  },
  { id: 'account', labelKey: 'settings.category.account', icon: CircleUser },
  { id: 'about', labelKey: 'settings.category.about', icon: Info },
  // Same compile-time gate as DevOptions; the runtime guard there stays.
  ...(import.meta.env.DEV ? [DEV_CATEGORY] : []),
]
