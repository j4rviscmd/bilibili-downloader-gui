import { invoke } from '@tauri-apps/api/core'

/**
 * Formats an error from Tauri invoke call with consistent prefix.
 */
function formatError(prefix: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`${prefix}:`, error)
  return new Error(`${prefix}: ${message}`)
}

/**
 * Wrapper for Tauri invoke calls with consistent error handling.
 */
async function invokeWithErrorHandling<T>(
  command: string,
  args: Record<string, unknown>,
  errorPrefix: string,
): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    throw formatError(errorPrefix, error)
  }
}

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
export const getThumbnailBase64 = (url: string): Promise<string> =>
  invokeWithErrorHandling('get_thumbnail_base64', { url }, 'Failed to fetch thumbnail')
