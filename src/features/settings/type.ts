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
   * Defaults to 14 if not specified.
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
  /**
   * Default output format for the audio extraction feature.
   * Defaults to 'mp3' if not specified.
   */
  audioFormat?: AudioFormat
  /**
   * Default rotation angle for the MP4 rotation feature.
   * Defaults to 90 if not specified.
   */
  rotationAngle?: RotationAngle
  /**
   * Default rotation mode for the MP4 rotation feature.
   * Defaults to 'copy' if not specified.
   */
  rotationMode?: RotationMode
  /**
   * UI theme: 'light' or 'dark'.
   * Persisted to settings.json via Tauri backend.
   * Defaults to 'light' if not set.
   */
  theme?: Theme
  /**
   * Whether to show download progress on the taskbar.
   * Defaults to true if not specified.
   */
  showTaskbarProgress?: boolean
  /**
   * Whether to flash the taskbar button when downloads complete.
   * Defaults to true if not specified.
   */
  flashTaskbarOnComplete?: boolean
  /**
   * Video codec priority preference.
   * Defaults to 'av1First' if not specified.
   */
  videoCodecPriority?: VideoCodecPriority
  /**
   * Number of parallel segment downloads (1, 2, 4, 6, or 8).
   * Defaults to 8 if not specified.
   */
  downloadParallelism?: number
}

/**
 * Font size preset in pixels, applied as root font-size.
 * All rem-based Tailwind utilities scale proportionally.
 */
export type FontSizePreset = 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20

/**
 * UI theme preference.
 * - light: Light theme
 * - dark: Dark theme
 */
export type Theme = 'light' | 'dark'

/**
 * Trim mode for MP4 trimming.
 * - copy: Stream copy, fast but keyframe-accurate only
 * - reencode: Re-encode, slow but frame-accurate
 */
export type TrimMode = 'copy' | 'reencode'

/**
 * Output format for audio extraction.
 * - mp3: MP3 (libmp3lame)
 * - m4a: AAC in MP4 container
 */
export type AudioFormat = 'mp3' | 'm4a'

/**
 * Rotation angle for MP4 rotation (clockwise degrees).
 * - 90: Rotate clockwise 90° (right)
 * - 180: Rotate 180° (upside-down)
 * - 270: Rotate clockwise 270° (left, counter-clockwise 90°)
 */
export type RotationAngle = 90 | 180 | 270

/**
 * Rotation mode for MP4 rotation.
 * - copy: Metadata-only rotation, fast but some players ignore it
 * - reencode: Re-encode with transpose filter, works in all players
 */
export type RotationMode = 'copy' | 'reencode'

/**
 * Video codec priority preference.
 * - av1First: Prefer AV1, fallback to HEVC, then AVC (default - best compression)
 * - hevcFirst: Prefer HEVC, fallback to AVC (balance)
 * - avcOnly: Prefer AVC only (best compatibility)
 */
export type VideoCodecPriority = 'av1First' | 'hevcFirst' | 'avcOnly'

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
