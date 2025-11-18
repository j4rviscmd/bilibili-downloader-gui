import { store } from '@/app/store'
import { enqueue } from '@/shared/queue/queueSlice'
import { invoke } from '@tauri-apps/api/core'

export const downloadVideo = async (
  videoId: string,
  cid: number,
  filename: string,
  quality: number,
  downloadId: string,
  parentId?: string,
) => {
  // enqueue prior to backend invoke
  store.dispatch(enqueue({ downloadId, parentId, filename, status: 'pending' }))
  try {
    await invoke<void>('download_video', {
      bvid: videoId,
      cid,
      filename,
      quality,
      downloadId,
      parentId,
    })
  } finally {
    // dequeue handled by progress events
  }
}
