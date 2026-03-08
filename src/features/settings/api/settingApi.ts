import type { Settings } from '@/features/settings/type'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/shared/lib/logger'

/**
 * Retrieves application settings from the Tauri backend.
 *
 * Invokes the 'get_settings' Tauri command to fetch persisted settings
 * from the backend storage (typically a JSON file).
 *
 * @returns A promise resolving to the app settings object
 *
 * @example
 * ```typescript
 * const settings = await callGetSettings()
 * console.log(settings.language) // 'en', 'ja', etc.
 * ```
 */
export const callGetSettings = async (): Promise<Settings> => {
  logger.debug('callGetSettings: Fetching settings')
  try {
    const result = await invoke<Settings>('get_settings')
    logger.debug(`callGetSettings: Settings loaded, language=${result.language}`)
    return result
  } catch (error) {
    logger.error('callGetSettings: Failed to fetch settings', error)
    throw error
  }
}

/**
 * Persists application settings to the Tauri backend.
 *
 * Invokes the 'set_settings' Tauri command to save settings to persistent
 * storage. The backend performs validation and handles file I/O.
 *
 * @param settings - The settings object to persist
 * @returns A promise that resolves when the settings are saved
 * @throws Error if the backend fails to save (e.g., invalid path, disk full)
 *
 * @example
 * ```typescript
 * await callSetSettings({ dlOutputPath: '/downloads', language: 'en' })
 * ```
 */
export const callSetSettings = async (settings: Settings): Promise<void> => {
  logger.debug(`callSetSettings: Saving settings, language=${settings.language}`)
  try {
    await invoke('set_settings', { settings })
    logger.debug('callSetSettings: Settings saved successfully')
  } catch (error) {
    logger.error('callSetSettings: Failed to save settings', error)
    throw error
  }
}

/**
 * Updates the library storage path and moves ffmpeg to the new location.
 *
 * Invokes the 'update_lib_path' Tauri command to:
 * - Move ffmpeg from the old path to the new path with validation
 * - Update settings.json with the new lib_path
 *
 * @param newPath - New library path (without /lib suffix; /lib will be appended)
 * @returns A promise that resolves when the path is updated
 * @throws Error if the operation fails (original lib_path is preserved)
 *
 * @example
 * ```typescript
 * await callUpdateLibPath('/Volumes/ExternalDrive/MyLib')
 * // This will move ffmpeg to '/Volumes/ExternalDrive/MyLib/lib/'
 * ```
 */
export const callUpdateLibPath = async (newPath: string): Promise<void> => {
  logger.info(`callUpdateLibPath: Updating lib path to ${newPath}`)
  try {
    await invoke('update_lib_path', { newPath })
    logger.info('callUpdateLibPath: Lib path updated successfully')
  } catch (error) {
    logger.error(`callUpdateLibPath: Failed to update lib path to ${newPath}`, error)
    throw error
  }
}

/**
 * Retrieves the current library path.
 *
 * Invokes the 'get_current_lib_path' Tauri command to fetch the current
 * library path. If no custom path is set, returns the default path.
 *
 * @returns A promise resolving to the current library path string
 *
 * @example
 * ```typescript
 * const libPath = await callGetCurrentLibPath()
 * console.log(libPath) // '/Users/xxx/Library/Application Support/com.bilibili.downloader/lib'
 * ```
 */
export const callGetCurrentLibPath = async (): Promise<string> => {
  logger.debug('callGetCurrentLibPath: Fetching current lib path')
  try {
    const result = await invoke<string>('get_current_lib_path')
    logger.debug(`callGetCurrentLibPath: Current lib path=${result}`)
    return result
  } catch (error) {
    logger.error('callGetCurrentLibPath: Failed to fetch current lib path', error)
    throw error
  }
}
