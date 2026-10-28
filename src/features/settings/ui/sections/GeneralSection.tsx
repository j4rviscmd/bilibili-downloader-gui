import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { Slider } from '@/components/ui/slider'
import { languages } from '@/features/settings/language/languages'
import {
  applyFontSize,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  parseFontSize,
} from '@/features/settings/lib/fontSize'
import type { FontSizePreset, SupportedLang } from '@/features/settings/type'
import { SettingRow } from '@/features/settings/ui/SettingRow'
import { SettingToggleGroup } from '@/features/settings/ui/SettingToggleGroup'
import { useSettings } from '@/features/settings/useSettings'
import {
  isPageEnabled,
  PAGE_DEFS,
  pageKey,
  TOGGLEABLE_PAGES,
} from '@/shared/layout/pages'
import { Label } from '@/shared/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'
import { Separator } from '@/shared/ui/separator'
import { Switch } from '@/shared/ui/switch'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * General category: appearance-level preferences (language, theme, font
 * size) and app-bar/startup toggles.
 */
export function GeneralSection() {
  const { t } = useTranslation()
  const { settings, saveByForm, updateLanguage } = useSettings()
  const currentFontSize = parseFontSize(settings.fontSize)
  const disabledPages = settings.disabledPages
  // Startup-page Select options: every page except /settings itself,
  // limited to enabled pages (labels reuse the sidebar nav keys).
  // Registry order keeps the '/popular' default on top; no test pins the
  // order (the options test sorts both sides).
  const startupOptions = PAGE_DEFS.filter(
    (def) => pageKey(def) !== '/settings' && isPageEnabled(def, disabledPages),
  )
  // Why normalize: pre-/popular versions stored '/video-search' as the
  // startup page; that path now redirects to /popular, so the Select
  // normalizes it for display (the stored value itself is left
  // untouched). A disabled startup page shows the first enabled option —
  // IndexPage owns the actual launch fallback.
  const normalizedStartupPage =
    settings.startupPage === '/video-search'
      ? '/popular'
      : (settings.startupPage ?? '/popular')
  // The list is never empty: /search and /downloads are required (never
  // hideable), so the fallback option always exists.
  const startupPageValue = startupOptions.some(
    (def) => pageKey(def) === normalizedStartupPage,
  )
    ? normalizedStartupPage
    : pageKey(startupOptions[0])

  // Show the platform-native modifier in shortcut hints (Cmd on macOS,
  // Ctrl elsewhere). `userAgent` is used because `navigator.platform` is
  // deprecated.
  const isMac =
    typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)
  const shortcutModKey = isMac ? '⌘' : 'Ctrl'

  /**
   * Handles font size slider changes.
   *
   * Parses the raw slider value into a valid preset, applies it to the
   * document root, and persists the setting via the settings hook.
   */
  const handleFontSizeChange = useCallback(
    (value: number[]) => {
      const size = parseFontSize(value[0]) as FontSizePreset
      applyFontSize(size)
      saveByForm({ fontSize: size })
    },
    [saveByForm],
  )

  /**
   * Patches the disabledPages list for one page-visibility toggle. The
   * sidebar filters itself and the persistent layout unmounts/redirects
   * on the merged settings update — this only persists the list.
   */
  const togglePageVisibility = useCallback(
    (key: string, visible: boolean) => {
      const current = settings.disabledPages ?? []
      const next = visible
        ? current.filter((p) => p !== key)
        : current.includes(key)
          ? current
          : [...current, key]
      void saveByForm({ disabledPages: next })
    },
    [settings.disabledPages, saveByForm],
  )

  return (
    <div className="space-y-6">
      <SettingRow label={t('settings.language_label')}>
        <Select
          value={settings.language ?? 'en'}
          onValueChange={(value) => {
            updateLanguage(value as SupportedLang)
          }}
        >
          <SelectTrigger
            aria-label={t('settings.language_label')}
            className="w-48"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {languages.map((lang) => (
              <SelectItem key={lang.id} value={lang.id}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow label={t('settings.startupPage_label')}>
        <Select
          value={startupPageValue}
          onValueChange={(value) => {
            void saveByForm({ startupPage: value })
          }}
        >
          <SelectTrigger
            aria-label={t('settings.startupPage_label')}
            className="w-48"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {startupOptions.map((def) => (
              <SelectItem key={pageKey(def)} value={pageKey(def)}>
                {t(def.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
      <SettingRow label={t('settings.theme_label')}>
        <SettingToggleGroup
          value={settings.theme ?? 'light'}
          onValueChange={(value) => {
            saveByForm({ theme: value as 'light' | 'dark' })
          }}
          options={[
            { value: 'light', label: t('settings.theme_light') },
            { value: 'dark', label: t('settings.theme_dark') },
          ]}
        />
      </SettingRow>
      <SettingRow label={t('settings.accent_label')}>
        <SettingToggleGroup
          value={settings.accentColor ?? 'pink'}
          onValueChange={(value) => {
            saveByForm({ accentColor: value as 'pink' | 'blue' })
          }}
          options={[
            { value: 'pink', label: t('settings.accent_pink') },
            { value: 'blue', label: t('settings.accent_blue') },
          ]}
        />
      </SettingRow>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Label>{t('settings.font_size_label')}</Label>
          <KbdGroup>
            <Kbd>{shortcutModKey}</Kbd>
            <Kbd>+/-</Kbd>
          </KbdGroup>
        </div>
        <p className="text-muted-foreground text-sm">
          {t('settings.font_size_description')}
        </p>
        <div className="flex items-center gap-4">
          <Slider
            min={FONT_SIZE_MIN}
            max={FONT_SIZE_MAX}
            step={1}
            value={[currentFontSize]}
            onValueChange={handleFontSizeChange}
            className="flex-1"
          />
          <span className="w-10 text-right text-sm tabular-nums">
            {currentFontSize}px
          </span>
        </div>
      </div>
      <Separator />
      <SettingRow
        label={t('settings.show_github_stars_label')}
        description={t('settings.show_github_stars_description')}
      >
        <Switch
          checked={settings.showGithubStars ?? true}
          onCheckedChange={(checked) => {
            saveByForm({ showGithubStars: checked })
          }}
        />
      </SettingRow>
      <Separator />
      <div className="space-y-1">
        <Label>{t('settings.page_visibility_label')}</Label>
        <p className="text-muted-foreground text-sm">
          {t('settings.page_visibility_description')}
        </p>
      </div>
      {TOGGLEABLE_PAGES.map((def) => {
        const key = pageKey(def)
        const switchId = `page-visibility-${key.replaceAll('/', '')}`
        return (
          <SettingRow key={key} label={t(def.labelKey)} htmlFor={switchId}>
            {/* Note: checked is inverted on purpose — the Switch shows
                "visible", while the persisted setting lists hidden pages. */}
            <Switch
              id={switchId}
              checked={!disabledPages?.includes(key)}
              onCheckedChange={(visible) => togglePageVisibility(key, visible)}
            />
          </SettingRow>
        )
      })}
    </div>
  )
}
