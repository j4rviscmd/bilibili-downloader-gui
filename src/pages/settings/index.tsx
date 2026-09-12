import type { SettingsCategoryId } from '@/features/settings/categories'
import { CategoryNav } from '@/features/settings/ui/CategoryNav'
import { DevOptions } from '@/features/settings/ui/DevOptions'
import { AboutSection } from '@/features/settings/ui/sections/AboutSection'
import { AccountSection } from '@/features/settings/ui/sections/AccountSection'
import { DownloadSection } from '@/features/settings/ui/sections/DownloadSection'
import { GeneralSection } from '@/features/settings/ui/sections/GeneralSection'
import { NotificationsSection } from '@/features/settings/ui/sections/NotificationsSection'
import { StorageSection } from '@/features/settings/ui/sections/StorageSection'
import { ToolDefaultsSection } from '@/features/settings/ui/sections/ToolDefaultsSection'
import { useSettings } from '@/features/settings/useSettings'
import { PageTemplate } from '@/shared/layout'
import { logger } from '@/shared/lib/logger'
import type { FC } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'

const SECTION_BY_CATEGORY: Record<SettingsCategoryId, FC> = {
  general: GeneralSection,
  download: DownloadSection,
  storage: StorageSection,
  notifications: NotificationsSection,
  toolDefaults: ToolDefaultsSection,
  account: AccountSection,
  about: AboutSection,
  dev: DevOptions,
}

/**
 * Settings page content.
 *
 * Mounted by `PersistentPageLayout` at `/settings` (issue #398): a left
 * category nav selects which section is mounted on the right. All saves
 * remain per-control auto-save patches.
 *
 * Because the page stays mounted behind `display:none`, settings.json is
 * re-read whenever the page becomes visible again — settings.json is
 * shared across app instances (issue #560) and another instance may have
 * saved newer values since this window's snapshot.
 */
export function SettingsContent() {
  const { t } = useTranslation()
  const { getSettings } = useSettings()
  const [category, setCategory] = useState<SettingsCategoryId>('general')
  const { pathname } = useLocation()
  const prevPathname = useRef(pathname)

  useEffect(() => {
    const becameVisible =
      prevPathname.current !== '/settings' && pathname === '/settings'
    prevPathname.current = pathname
    if (becameVisible) {
      getSettings().catch((e) => {
        logger.warn(`SettingsContent: refresh on visible failed: ${String(e)}`)
      })
    }
  }, [pathname, getSettings])

  useEffect(() => {
    document.title = `${t('settings.title')} - ${t('app.title')}`
  }, [t])

  const Section = SECTION_BY_CATEGORY[category]

  return (
    <PageTemplate
      title={t('settings.title')}
      description={t('settings.auto_save_note')}
    >
      <div className="flex min-h-0 flex-1 gap-6 pt-2 pb-4 sm:pt-3 sm:pb-6">
        <CategoryNav active={category} onSelect={setCategory} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Section />
        </div>
      </div>
    </PageTemplate>
  )
}

export default SettingsContent
