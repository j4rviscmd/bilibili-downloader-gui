import { invoke } from '@tauri-apps/api/core'

/**
 * Expands a b23.tv short URL to its full bilibili.com URL.
 *
 * This function calls the Tauri backend to follow HTTP redirects
 * and resolve the final URL.
 *
 * @param url - The b23.tv short URL to expand
 * @returns A promise resolving to the full bilibili.com URL
 * @throws Error if the expansion fails (network issues, redirect limit exceeded, etc.)
 *
 * @example
 * ```typescript
 * try {
 *   const fullUrl = await expandShortUrl('https://b23.tv/BV1xx411c7XD')
 *   console.log('Expanded URL:', fullUrl)
 *   // Output: 'https://www.bilibili.com/video/BV1xx411c7XD'
 * } catch (e) {
 *   console.error('Failed to expand short URL:', e)
 * }
 * ```
 */
export const expandShortUrl = async (url: string): Promise<string> => {
  return await invoke<string>('expand_short_url', { url })
}
