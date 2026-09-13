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
      <SettingRow
        label={t('settings.skip_splash_animation_label')}
        description={t('settings.skip_splash_animation_description')}
      >
        <Switch
          checked={settings.skipSplashAnimation ?? false}
          onCheckedChange={(checked) => {
            saveByForm({ skipSplashAnimation: checked })
          }}
        />
      </SettingRow>
    </div>
  )
}
