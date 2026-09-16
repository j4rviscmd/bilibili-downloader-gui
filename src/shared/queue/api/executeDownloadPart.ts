import { logger } from '@/shared/lib/logger'
import { invoke } from '@tauri-apps/api/core'

import type { DownloadPartPayload } from '../types'

/** Default part executor: invokes the backend `download_video` command. */
export type PartExecutor = (
  payload: DownloadPartPayload,
  ids: { downloadId: string; parentId: string },
) => Promise<string>

/**
 * Executes one queued part via the Tauri backend.
 *
 * Successor of the abolished `features/video/api/downloadVideo.ts`: pure
 * invocation — no queue bookkeeping (the runner owns status transitions),
 * which makes it trivially replaceable by a fake in runner unit tests.
 *
 * @returns Resolves with the output file path; rejects with the raw error
 *   (classified by the runner).
 */
export const executeDownloadPart: PartExecutor = async (payload, ids) => {
  logger.info(
    `executeDownloadPart: starting id=${ids.downloadId}, videoId=${payload.videoId}, cid=${payload.cid}`,
  )
  const outputPath = await invoke<string>('download_video', {
    options: {
      bvid: payload.videoId,
      cid: payload.cid,
      filename: payload.filename,
      quality: payload.quality,
      audioQuality: payload.audioQuality,
      downloadId: ids.downloadId,
      parentId: ids.parentId,
      durationSeconds: payload.durationSeconds,
      thumbnailUrl: payload.thumbnailUrl,
      page: payload.page,
      epId: payload.epId,
      subtitle: payload.subtitle,
    },
  })
  logger.info(
    `executeDownloadPart: completed id=${ids.downloadId}, outputPath=${outputPath}`,
  )
  return outputPath
}
