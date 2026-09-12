import { logger } from '@/shared/lib/logger'
import { open } from '@tauri-apps/plugin-dialog'
import { t as staticT } from 'i18next'

/**
 * Opens a native directory selection dialog.
 *
 * Thin wrapper around the Tauri `open` dialog shared by the settings
 * sections (download output path, library path) to keep error handling
 * consistent: a cancel or a failure both resolve to `null` so callers
 * can treat them as "no selection".
 *
 * @param titleKey - i18n key used as the dialog title
 * @param defaultPath - Optional path the dialog opens at
 * @returns The selected path, or `null` if the user cancels or an error
 *   occurs
 */
export async function openDirectoryDialog(
  titleKey: string,
  defaultPath?: string,
): Promise<string | null> {
  try {
    return await open({
      directory: true,
      multiple: false,
      title: staticT(titleKey),
      defaultPath,
    })
  } catch (error) {
    logger.error('Failed to open directory dialog', error)
    return null
  }
}
