import { invoke } from '@tauri-apps/api/core'

const ERROR_PREFIX = 'Failed to fetch thumbnail'

/**
 * Fetches and encodes a thumbnail image as base64 data URL.
 *
 * Downloads the image from the given URL using the backend to bypass
 * Referer/CORS restrictions, then returns a base64-encoded data URL.
 *
 * @param url - Thumbnail image URL
 * @returns Base64-encoded data URL (e.g., "data:image/jpeg;base64,...")
 * @throws Error if thumbnail fetch fails
 */
export async function getThumbnailBase64(url: string): Promise<string> {
  try {
    return await invoke<string>('get_thumbnail_base64', { url })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`${ERROR_PREFIX}:`, error)
    throw new Error(`${ERROR_PREFIX}: ${message}`)
  }
}
