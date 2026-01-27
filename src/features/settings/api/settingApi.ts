import type { Settings } from '@/features/settings/type'
import { invoke } from '@tauri-apps/api/core'

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
export const callGetSettings = async () => {
  const res = await invoke<Settings>('get_settings')

  return res
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
export const callSetSettings = async (settings: Settings) => {
  const res = await invoke('set_settings', { settings })

  return res
}
