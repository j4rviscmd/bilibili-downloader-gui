import { invoke } from '@tauri-apps/api/core'

export const downloadVideo = async (
  videoId: string,
  filename: string,
  quality: number,
) => {
  // Create a downloadId and enqueue before invoking backend
  const downloadId = uuidv4()
  store.dispatch(enqueue({ downloadId, filename }))

  try {
    await invoke<void>('download_video', { videoId, filename, quality })
  } finally {
    // Note: actual dequeue will be handled by progress events; keep this as fallback
  }
}
