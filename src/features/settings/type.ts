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
   * Download speed threshold in MB/s for initial speed check.
   *
   * If the initial download speed (measured over 1MB) falls below this threshold,
   * the connection will be dropped and retried to get a different CDN node.
   *
   * @default 1.0
   */
  downloadSpeedThresholdMbps?: number
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
