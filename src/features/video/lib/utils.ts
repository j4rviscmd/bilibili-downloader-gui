/**
 * Utility functions for the video feature.
 *
 * NOTE: Keep logic lightweight; avoid duplicating complex validation.
 */

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

/**
 * Converts base64 thumbnail data to a data URL.
 *
 * If the data already has a data URL prefix, returns it as-is.
 * Otherwise, prepends the PNG data URL prefix.
 *
 * @param base64 - The base64 encoded image data
 * @returns A complete data URL
 *
 * @example
 * ```typescript
 * toThumbnailDataUrl('iVBORw0KG...') // 'data:image/png;base64,iVBORw0KG...'
 * toThumbnailDataUrl('data:image/jpeg;base64,iVBORw0KG...') // 'data:image/jpeg;base64,iVBORw0KG...'
 * ```
 */
export const toThumbnailDataUrl = (base64: string): string => {
  return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`
}
