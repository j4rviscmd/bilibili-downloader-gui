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
}

/**
 * Complete user input for a video download.
 */
export type Input = {
  /** Bilibili video URL */
  url: string
  /** Input settings for each video part */
  partInputs: PartInput[]
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
}

/**
 * Metadata for a single video part.
 */
export type VideoPart = {
  /** Part name/subtitle */
  part: string
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
}

/**
 * Thumbnail image data.
 */
export type Thumbnail = {
  /** Thumbnail URL */
  url: string
  /** Base64-encoded thumbnail image */
  base64: string
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
