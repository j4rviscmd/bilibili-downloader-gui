import { SettingField } from '@/features/settings/ui/SettingRow'
import { SettingToggleGroup } from '@/features/settings/ui/SettingToggleGroup'
import { useSettings } from '@/features/settings/useSettings'
import { Separator } from '@/shared/ui/separator'
import { useTranslation } from 'react-i18next'

/**
 * Tool defaults category: the default modes/formats the tool pages
 * (trim / audio / rotation) start with.
 */
export function ToolDefaultsSection() {
  const { t } = useTranslation()
  const { settings, saveByForm } = useSettings()

  // The copy/reencode pair repeats across trim and rotation with
  // per-feature warning tooltips (keyframe vs metadata).
  const copyReencodeChoices = (
    labelKeyPrefix: string,
    warningKeyPrefix: string,
  ) => [
    {
      value: 'copy',
      label: t(`settings.${labelKeyPrefix}_copy`),
      tooltip: t(`${warningKeyPrefix}.warningKeyframe`),
    },
    {
      value: 'reencode',
      label: t(`settings.${labelKeyPrefix}_reencode`),
      tooltip: t(`${warningKeyPrefix}.warningReencode`),
    },
  ]

  return (
    <div className="space-y-6">
      <SettingField
        label={t('settings.trim_mode_label')}
        description={t('settings.trim_mode_description')}
      >
        <SettingToggleGroup
          value={settings.trimMode ?? 'copy'}
          onValueChange={(value) => {
            saveByForm({ trimMode: value as 'copy' | 'reencode' })
          }}
          options={copyReencodeChoices('trim_mode', 'trim')}
        />
      </SettingField>
      <Separator />
      <SettingField
        label={t('settings.audio_format_label')}
        description={t('settings.audio_format_description')}
      >
        <SettingToggleGroup
          value={settings.audioFormat ?? 'mp3'}
          onValueChange={(value) => {
            saveByForm({ audioFormat: value as 'mp3' | 'm4a' })
          }}
          options={[
            { value: 'mp3', label: t('settings.audio_format_mp3') },
            { value: 'm4a', label: t('settings.audio_format_m4a') },
          ]}
        />
      </SettingField>
      <Separator />
      <SettingField
        label={t('settings.gif_format_label')}
        description={t('settings.gif_format_description')}
      >
        <SettingToggleGroup
          value={settings.gifFormat ?? 'gif'}
          onValueChange={(value) => {
            saveByForm({ gifFormat: value as 'gif' | 'webm' })
          }}
          options={[
            { value: 'gif', label: t('settings.gif_format_gif') },
            { value: 'webm', label: t('settings.gif_format_webm') },
          ]}
        />
      </SettingField>
      <Separator />
      <SettingField
        label={t('settings.rotation_mode_label')}
        description={t('settings.rotation_mode_description')}
      >
        <SettingToggleGroup
          value={settings.rotationMode ?? 'copy'}
          onValueChange={(value) => {
            saveByForm({ rotationMode: value as 'copy' | 'reencode' })
          }}
          options={[
            {
              value: 'copy',
              label: t('settings.rotation_mode_copy'),
              tooltip: t('rotation.warningMetadata'),
            },
            {
              value: 'reencode',
              label: t('settings.rotation_mode_reencode'),
              tooltip: t('rotation.warningReencode'),
            },
          ]}
        />
      </SettingField>
      <SettingField
        label={t('settings.rotation_angle_label')}
        description={t('settings.rotation_angle_description')}
      >
        <SettingToggleGroup
          value={String(settings.rotationAngle ?? 90)}
          onValueChange={(value) => {
            saveByForm({ rotationAngle: Number(value) as 90 | 180 | 270 })
          }}
          options={[
            { value: '90', label: t('rotation.angle.right90') },
            { value: '180', label: t('rotation.angle.180') },
            { value: '270', label: t('rotation.angle.left90') },
          ]}
        />
      </SettingField>
    </div>
  )
}
