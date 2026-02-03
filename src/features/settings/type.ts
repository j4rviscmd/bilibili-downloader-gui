/**
 * Application settings structure.
 *
 * Persisted to the backend as JSON via Tauri commands.
 */
export interface Settings {
  /** Directory path for downloaded videos */
  dlOutputPath: string
  /** Current application language */
  language: SupportedLang
  /**
   * Custom path for library dependencies (ffmpeg, etc.).
   *
   * If not specified, defaults to `app_data_dir()/lib/`.
   * This allows users to store large dependencies like ffmpeg on
   * a different drive or location with more storage space.
   */
  libPath?: string
  // Frontendのみの管理につき、localStorageでのみ保存している
  // TODO: themeをjson管理
  // theme: 'light' | 'dark'
}

/**
 * Supported language codes for the application.
 */
export type SupportedLang = 'en' | 'ja' | 'fr' | 'es' | 'zh' | 'ko'

/**
 * Language definition with ID and display label.
 */
export type Language = {
  /** Localized display name of the language */
  label: string
  /** Language code (e.g., 'en', 'ja') */
  id: SupportedLang
}
