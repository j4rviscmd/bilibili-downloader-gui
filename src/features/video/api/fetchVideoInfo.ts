import type { Video } from '@/features/video/types'
import { invoke } from '@tauri-apps/api/core'

export const fetchVideoInfo = async (id: string) => {
  let res: Video | null = null
  try {
    res = await invoke<Video>('fetch_video_info', { videoId: id })
  } catch (e) {
    console.error(e)
    res = null
  }

  return res
}
