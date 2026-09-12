import { callGetCurrentLibPath } from '@/features/settings/api/settingApi'
import { openDirectoryDialog } from '@/features/settings/lib/directoryDialog'
import { SettingField } from '@/features/settings/ui/SettingRow'
import { useSettings } from '@/features/settings/useSettings'
import { logger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Storage category: where large bundled dependencies (ffmpeg, …) live.
 */
export function StorageSection() {
  const { t } = useTranslation()
  const { settings, updateLibPath } = useSettings()
  const [isUpdatingLibPath, setIsUpdatingLibPath] = useState(false)
  const [currentLibPath, setCurrentLibPath] = useState<string>('')

  useEffect(() => {
    const fetchCurrentLibPath = async () => {
      try {
        setCurrentLibPath(await callGetCurrentLibPath())
      } catch (error) {
        logger.error('Failed to get current lib path', error)
        setCurrentLibPath(t('settings.lib_path_error'))
      }
    }
    fetchCurrentLibPath()
  }, [settings.libPath, t])

  /** Handles library path selection. */
  const handleLibPathChange = async () => {
    setIsUpdatingLibPath(true)
    try {
      const selected = await openDirectoryDialog(
        'settings.lib_path_dialog_title',
        currentLibPath,
      )
      if (selected) {
        await updateLibPath(selected)
      }
    } finally {
      setIsUpdatingLibPath(false)
    }
  }

  return (
    <div className="space-y-6">
      <SettingField
        label={t('settings.lib_path_label')}
        description={t('settings.lib_path_description')}
      >
        <div className="flex items-center gap-2">
          <Input
            readOnly
            value={currentLibPath}
            placeholder={t('settings.lib_path_default')}
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleLibPathChange}
            disabled={isUpdatingLibPath}
          >
            {t(
              isUpdatingLibPath
                ? 'settings.lib_path_changing'
                : 'settings.lib_path_button',
            )}
          </Button>
        </div>
      </SettingField>
    </div>
  )
}
