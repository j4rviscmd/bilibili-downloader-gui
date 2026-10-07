import { invoke } from '@tauri-apps/api/core'
import type { VideoSearchEntry } from '../types'

/**
 * Fetches the personalized web-home recommendation feed via the
 * `fetch_home_recommendations` command. Returns `[]` when logged out or
 * on failure — the backend never errors for this decorative shelf.
 */
export async function fetchHomeRecommendationsApi(): Promise<
  VideoSearchEntry[]
> {
  return invoke<VideoSearchEntry[]>('fetch_home_recommendations')
}
