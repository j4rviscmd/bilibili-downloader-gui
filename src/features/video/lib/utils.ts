/**
 * Utility functions for the video feature.
 *
 * NOTE: Keep logic lightweight; avoid duplicating complex validation.
 */

/**
 * Extracted content identifier from a Bilibili URL.
 */
export type ExtractedId =
  | { type: 'video'; id: string }
  | { type: 'bangumi'; epId: string }
  | null

/**
 * Extracts the content ID and type from a Bilibili URL.
 *
 * Supports both regular videos and bangumi episodes.
 *
 * @param url - The Bilibili URL.
 * @returns The extracted content identifier or null if not found.
 *
 * @example
 * ```typescript
 * extractContentId('https://www.bilibili.com/video/BV1xx411c7XD')
 * // Returns: { type: 'video', id: 'BV1xx411c7XD' }
 *
 * extractContentId('https://www.bilibili.com/bangumi/play/ep3051843')
 * // Returns: { type: 'bangumi', epId: '3051843' }
 * ```
 */
export const extractContentId = (url: string): ExtractedId => {
  try {
    const urlObj = new URL(url)
    const { pathname } = urlObj

    // Bangumi: /bangumi/play/ep{ep_id}
    const bangumiMatch = pathname.match(/\/bangumi\/play\/ep(\d+)/)
    if (bangumiMatch) {
      return { type: 'bangumi', epId: bangumiMatch[1] }
    }

    // Regular video: /video/{bvid}
    const videoMatch = pathname.match(/\/video\/([a-zA-Z0-9]+)/)
    if (videoMatch) {
      return { type: 'video', id: videoMatch[1] }
    }

    return null
  } catch {
    return null
  }
}

/**
 * Extracts the Bilibili video ID from a URL.
 *
 * @param url - The Bilibili video URL.
 * @returns The video ID (e.g., 'BV1234567890') or null if not found.
 *
 * @example
 * ```typescript
 * extractVideoId('https://www.bilibili.com/video/BV1xx411c7XD')
 * // Returns: 'BV1xx411c7XD'
 * ```
 */
export const extractVideoId = (url: string): string | null => {
  const match = url.match(/\/video\/([a-zA-Z0-9]+)/)
  return match ? match[1] : null
}

/**
 * Regex matching all characters forbidden in filenames.
 *
 * Windows: \\ / : * ? " < > |
 * Non-Windows (macOS/Linux): /
 * Since OS detection is async, this uses a broad superset.
 */
const FORBIDDEN_SUPERSET = /[\\/:*?"<>|]/g

/**
 * Normalizes a filename for duplicate detection.
 *
 * Removes forbidden characters, trims whitespace, and converts to lowercase.
 * Used to compare filenames case-insensitively without special characters.
 *
 * @param name - The original filename
 * @returns The normalized filename
 *
 * @example
 * ```typescript
 * normalizeFilename('My Video: Part 1') // 'my video part 1'
 * normalizeFilename('Test/File?') // 'testfile'
 * ```
 */
export const normalizeFilename = (name: string): string => {
  return name.trim().toLowerCase().replace(FORBIDDEN_SUPERSET, '')
}
