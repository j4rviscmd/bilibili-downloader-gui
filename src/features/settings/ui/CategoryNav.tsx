import type { SettingsCategoryId } from '@/features/settings/categories'
import { SETTINGS_CATEGORIES } from '@/features/settings/categories'
import { cn } from '@/shared/lib/utils'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

interface CategoryNavProps {
  active: SettingsCategoryId
  onSelect: (id: SettingsCategoryId) => void
}

/**
 * Left pane of the settings page: the category list.
 *
 * One category is visible at a time on the right; this nav owns the
 * selection highlighting and the current-position landmark (aria-current).
 */
export function CategoryNav({
  active,
  onSelect,
}: CategoryNavProps): ReactElement {
  const { t } = useTranslation()

  return (
    <nav aria-label={t('settings.title')} className="w-44 shrink-0 space-y-1">
      {SETTINGS_CATEGORIES.map(({ id, labelKey, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          aria-current={id === active || undefined}
          data-category={id}
          className={cn(
            'flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left text-sm',
            id === active
              ? 'bg-accent text-accent-foreground'
              : 'hover:bg-accent/50',
          )}
        >
          <Icon className="size-4" />
          <span>{t(labelKey)}</span>
        </button>
      ))}
    </nav>
  )
}
