import { logger } from '@/shared/lib/logger'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/ui/toast'
import { invoke } from '@tauri-apps/api/core'
import { ScrollText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Settings-screen action button that reveals the log file.
 *
 * Invokes the backend 'reveal_log_file' command, which owns the log
 * path scheme and opens the logs folder with `app.log` selected in the
 * system file manager. The frontend stays a pure presentation layer.
 *
 * @example
 * ```tsx
 * <OpenLogsButton />
 * ```
 */
export function OpenLogsButton() {
  const { t } = useTranslation()

  const handleOpenLogs = async () => {
    try {
      await invoke('reveal_log_file')
    } catch (error) {
      logger.error('OpenLogsButton: Failed to reveal log file', error)
      toast.error(t('settings.open_logs_failed'))
    }
  }

  return (
    <Button type="button" variant="outline" onClick={handleOpenLogs}>
      <ScrollText className="mr-2 size-4" />
      {t('settings.open_logs_button')}
    </Button>
  )
}
