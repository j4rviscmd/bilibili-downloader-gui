import { store } from '@/app/store'
import { enqueue } from '@/shared/queue/queueSlice'
import { invoke } from '@tauri-apps/api/core'

export const downloadVideo = async (
  videoId: string,
  filename: string,
  quality: number,
) => {
  // Generate a reasonably unique downloadId and enqueue before invoking backend
  const downloadId = `${videoId}-${Date.now()}-${Math.floor(Math.random() * 10000)}`
  store.dispatch(enqueue({ downloadId, filename }))

  try {
    await invoke<void>('download_video', {
      videoId,
      filename,
      quality,
      downloadId,
    })
  } finally {
    // Actual dequeue will be handled by progress events; keep this as a fallback
  }
}
