import { invoke } from '@tauri-apps/api/core'

/**
 * Supported operating system types.
 */
export type SupportedOs =
  | 'windows'
  | 'macos'
  | 'linux'
  | 'android'
  | 'ios'
  | 'freebsd'
  | 'dragonfly'
  | 'netbsd'
  | 'openbsd'
  | 'solaris'
  | 'unknown'

let cached: SupportedOs | null = null

/**
 * Retrieves the current operating system.
 *
 * Invokes the 'get_os' Tauri command and caches the result. Returns
 * 'unknown' if the OS cannot be determined or on error.
 *
 * @returns A promise resolving to the OS type
 *
 * @example
 * ```typescript
 * const os = await getOs()
 * if (os === 'windows') {
 *   // Windows-specific logic
 * }
 * ```
 */
export const getOs = async (): Promise<SupportedOs> => {
  if (cached) return cached
  try {
    const raw = await invoke<string>('get_os')
    // Normalize unexpected values
    const known = new Set<SupportedOs>([
      'windows',
      'macos',
      'linux',
      'android',
      'ios',
      'freebsd',
      'dragonfly',
      'netbsd',
      'openbsd',
      'solaris',
      'unknown',
    ])
    cached = (known.has(raw as SupportedOs) ? raw : 'unknown') as SupportedOs
    return cached
  } catch {
    return 'unknown'
  }
}
