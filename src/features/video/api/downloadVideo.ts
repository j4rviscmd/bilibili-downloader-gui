import { invoke } from '@tauri-apps/api/core'

export const downloadVideo = async (
  videoId: string,
  filename: string,
  quality: number,
) => {
  // 動画のダウンロード処理
  await invoke<void>('download_video', { videoId, filename, quality })
}
