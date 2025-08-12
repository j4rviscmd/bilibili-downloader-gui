import { invoke } from '@tauri-apps/api/core'

export const fetchVideoInfo = async (id: string) => {
  // TODO: Call backend
  await invoke('fetch_video_info', { id })
}
