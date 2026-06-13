/**
 * Title replacement rule for filename sanitization.
 *
 * Defines a single character or text replacement rule
 * that can be enabled or disabled by the user.
 */
export interface TitleReplacement {
  /** Character or text to replace */
  from: string
  /** Replacement text (empty string to delete) */
  to: string
  /** Whether this rule is active */
  enabled: boolean
}

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
  /**
   * Custom title replacement rules for filename sanitization.
   *
   * If not specified, backend uses default replacements.
   * Maximum 20 rules allowed.
   */
  titleReplacements?: TitleReplacement[]
  /**
   * Whether to automatically rename duplicate part titles.
   *
   * When enabled, duplicate titles are renamed with index suffixes
   * (e.g., "Part" → "Part (1)", "Part (2)").
   * Defaults to true if not specified.
   */
  autoRenameDuplicates?: boolean
  /**
   * Whether to show GitHub stars in the app bar.
   *
   * Defaults to true if not specified.
   */
  showGithubStars?: boolean
  /**
   * Whether to open devtools on app startup (development mode only).
   *
   * Defaults to true if not specified.
   */
  openDevtoolsOnStartup?: boolean
  /**
   * Whether the sidebar is expanded.
   *
   * Defaults to true if not specified.
   */
  sidebarExpanded?: boolean
  /**
   * Base font size in pixels (12-20).
   *
   * Applied as root font-size for rem-based scaling.
   * Defaults to 16 (browser default) if not specified.
   */
  fontSize?: FontSizePreset
  /**
   * Whether to skip the splash screen animation on startup.
   *
   * When enabled, a minimal loading indicator is shown instead
   * of the 3D animation for fastest possible startup.
   * Defaults to false if not specified.
   */
  skipSplashAnimation?: boolean
  /**
   * Default trim mode for the MP4 trimming feature.
   * Defaults to 'copy' if not specified.
   */
  trimMode?: TrimMode
  // Managed on frontend only, stored in localStorage
  // TODO: manage theme in json
  // theme: 'light' | 'dark'
}

/**
 * Font size preset in pixels, applied as root font-size.
 * All rem-based Tailwind utilities scale proportionally.
 */
export type FontSizePreset = 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20

/**
 * Trim mode for MP4 trimming.
 * - copy: Stream copy, fast but keyframe-accurate only
 * - reencode: Re-encode, slow but frame-accurate
 */
export type TrimMode = 'copy' | 'reencode'

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
