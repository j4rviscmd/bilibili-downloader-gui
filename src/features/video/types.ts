/**
 * Content type identifier.
 */
export type ContentType = 'video' | 'bangumi'

/**
 * User input for a specific video part.
 *
 * Stores the selected quality options and custom filename for each part.
 */
export type PartInput = {
  /** Video part CID (unique identifier) */
  cid: number
  /** Part page number (1-indexed) */
  page: number
  /** Custom filename for this part */
  title: string
  /** Selected video quality ID as string (e.g., '80' for 1080p) */
  videoQuality: string
  /** Selected audio quality ID as string (e.g., '30216' for 64K) */
  audioQuality: string
  /** Whether this part is selected for download */
  selected: boolean
  /** Duration in seconds for progress calculation */
  duration: number
  /** Thumbnail URL for this part */
  thumbnailUrl?: string
  /** Subtitle configuration */
  subtitle: SubtitleConfig
  /** Available subtitles (lazy-loaded) */
  subtitles?: SubtitleInfo[]
  /** Whether subtitles are currently loading */
  subtitlesLoading?: boolean
  /** Available video qualities (lazy-loaded) */
  videoQualities?: VideoQuality[]
  /** Available audio qualities (lazy-loaded) */
  audioQualities?: AudioQuality[]
  /** Whether qualities are currently loading */
  qualitiesLoading?: boolean
  /** Whether the "other options" accordion is open (persisted for virtual scroll) */
  accordionOpen?: boolean
  /** Preview mode flag (only first 6 minutes available) for bangumi */
  isPreview?: boolean
  /** Resolved quality info (set after download starts) */
  resolvedQuality?: ResolvedQuality
  /** Resolved subtitle info (set after download starts) */
  resolvedSubtitle?: ResolvedSubtitle
}

/**
 * Pending download item from watch history or favorites.
 *
 * Stores the video identifier for automatic download initiation
 * when navigating from the watch history or favorites page.
 */
export type PendingDownload = {
  /** Bilibili video ID (e.g., 'BV1xx411c7XD') */
  bvid: string
  /** Part CID (unique identifier for the specific part), null for favorites */
  cid: number | null
  /** Part page number (1-indexed) */
  page: number
}

/**
 * Complete user input for a video download.
 */
export type Input = {
  /** Bilibili video URL */
  url: string
  /** Input settings for each video part */
  partInputs: PartInput[]
  /** Pending download from watch history navigation */
  pendingDownload: PendingDownload | null
}

/**
 * Video metadata fetched from Bilibili.
 */
export type Video = {
  /** Video title */
  title: string
  /** Bilibili video ID (e.g., 'BV1xx411c7XD') */
  bvid: string
  /** List of video parts (episodes) */
  parts: VideoPart[]
  /** Indicates whether quality options are limited due to missing cookies */
  isLimitedQuality: boolean
  /** Content type (video or bangumi) */
  contentType: ContentType
  /** Episode ID for bangumi content */
  epId?: number
  /** Season title for bangumi content */
  seasonTitle?: string
}

/**
 * Metadata for a single video part.
 */
export type VideoPart = {
  /** Part name/subtitle (original from Bilibili, for display) */
  part: string
  /** Sanitized part name with special character replacement and duplicate avoidance (for download filename) */
  sanitizedPart?: string
  /** Page number (1-indexed) */
  page: number
  /** Part CID (unique identifier) */
  cid: number
  /** Duration in seconds */
  duration: number
  /** Available video quality options */
  videoQualities: VideoQuality[]
  /** Available audio quality options */
  audioQualities: AudioQuality[]
  /** Part thumbnail image */
  thumbnail: Thumbnail
  /** Available subtitles for this part */
  subtitles: SubtitleInfo[]
  /** Episode ID for bangumi content */
  epId?: number
  /** Episode status (2=free, 13=VIP-only) for bangumi */
  status?: number
  /** AID for bangumi content */
  aid?: number
  /** Preview mode flag (only first 6 minutes available) */
  isPreview?: boolean
}

/**
 * Thumbnail image data.
 */
export type Thumbnail = {
  /** Thumbnail URL */
  url: string
}

/**
 * Video quality option.
 */
export type VideoQuality = {
  /** Quality label (e.g., '1080p', '720p60') */
  quality: string
  /** Quality ID (e.g., 80, 116) */
  id: number
}

/**
 * Audio quality option.
 */
export type AudioQuality = {
  /** Quality label (e.g., '64K', 'Hi-Res Lossless') */
  quality: string
  /** Quality ID (e.g., 30216, 30251) */
  id: number
}

/**
 * Subtitle information for a video part.
 */
export type SubtitleInfo = {
  /** Language code (e.g., "zh-CN", "en") */
  lan: string
  /** Language display text (e.g., "中文（简体）") */
  lanDoc: string
  /** Subtitle URL (BCC JSON format) */
  subtitleUrl: string
  /** Whether this is an AI-generated subtitle */
  isAi: boolean
}

/**
 * Subtitle configuration for download.
 */
export type SubtitleConfig = {
  /** Subtitle embed mode: 'soft' for soft-sub, 'hard' for hard-sub */
  mode: 'soft' | 'hard' | 'off'
  /** Selected subtitle language codes (for soft-sub, multiple allowed) */
  selectedLans: string[]
}

/**
 * Resolved quality information from backend.
 *
 * Sent after quality selection to inform frontend of actual resolved
 * quality (may differ from user selection due to fallback).
 */
export type ResolvedQuality = {
  /** Resolved video quality ID */
  videoQuality: number
  /** Whether video quality was fallen back from user selection */
  videoQualityFallback: boolean
  /** Resolved audio quality ID (null for durl format) */
  audioQuality: number | null
  /** Whether audio quality was fallen back from user selection */
  audioQualityFallback: boolean
  /** Whether this is a preview (only first 6 minutes available) */
  isPreview: boolean | null
}

/**
 * Resolved subtitle information from backend.
 *
 * Sent after subtitle processing to inform frontend of the actual
 * subtitle mode and language labels.
 */
export type ResolvedSubtitle = {
  /** Subtitle mode: 'off', 'soft', or 'hard' */
  subtitleMode: 'off' | 'soft' | 'hard'
  /** Language labels from Bilibili (e.g., 'Español', '日本語') */
  subtitleLanguageLabels: string[]
}

/**
 * Payload for download-quality-resolved event.
 */
export type QualityResolvedPayload = {
  downloadId: string
  page: number
} & ResolvedQuality

/**
 * Payload for download-subtitle-resolved event.
 */
export type SubtitleResolvedPayload = {
  downloadId: string
  page: number
} & ResolvedSubtitle
