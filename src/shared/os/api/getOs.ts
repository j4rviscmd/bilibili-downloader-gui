import { invoke } from '@tauri-apps/api/core'

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
