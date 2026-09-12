import { SettingRow } from '@/features/settings/ui/SettingRow'
import { useSettings } from '@/features/settings/useSettings'
import { Switch } from '@/shared/ui/switch'
import { useTranslation } from 'react-i18next'

/**
 * Notifications category: download-completion feedback shown by the OS
 * taskbar/dock.
 */
export function NotificationsSection() {
  const { t } = useTranslation()
  const { settings, saveByForm } = useSettings()

  return (
    <div className="space-y-6">
      <SettingRow
        label={t('settings.taskbar_progress_label')}
        description={t('settings.taskbar_progress_description')}
      >
        <Switch
          checked={settings.showTaskbarProgress ?? true}
          onCheckedChange={(checked) => {
            saveByForm({ showTaskbarProgress: checked })
          }}
        />
      </SettingRow>
      <SettingRow
        label={t('settings.flash_taskbar_on_complete_label')}
        description={t('settings.flash_taskbar_on_complete_description')}
      >
        <Switch
          checked={settings.flashTaskbarOnComplete ?? true}
          onCheckedChange={(checked) => {
            saveByForm({ flashTaskbarOnComplete: checked })
          }}
        />
      </SettingRow>
    </div>
  )
}
