import { createSelector } from '@reduxjs/toolkit'

import type { RootState } from '@/app/store'
import type { Progress } from '@/shared/ui/Progress'

import type { OverallSummary, PartStatusRowModel } from './types'

/** ダイアログ開閉状態そのもの。 */
export const selectDownloadStatusDialogState = (state: RootState) =>
  state.downloadStatusDialog

/** ダイアログが開いているか。 */
export const selectDownloadStatusDialogOpen = (state: RootState) =>
  state.downloadStatusDialog.dialogOpen

/** 明示的に指定された表示対象の親DL ID。 */
export const selectActiveParentId = (state: RootState) =>
  state.downloadStatusDialog.activeParentId

/**
 * 表示対象の親DL IDを解決する。
 *
 * activeParentId がキューに存在すればそれを使い、
 * 無ければ直近（最後に enqueue された）の親を選ぶ。
 * 直列DL前提なので、同時に進行する親は実質1つ。
 *
 * 入力に state.queue（参照安定）を直接使う。新配列を返す入力セレクタを
 * 挟むと createSelector のメモ化が実質無効化するため。
 */
export const selectResolvedParentId = createSelector(
  [selectActiveParentId, (state: RootState) => state.queue],
  (activeParentId, queue) => {
    const parentIds = [
      ...new Set(
        queue.map((q) => q.parentId).filter((id): id is string => id != null),
      ),
    ]
    // Respect the explicitly-set parent even if it's no longer in the queue
    // (e.g. children were cancelled/cleared). Don't silently switch to a
    // different download.
    if (activeParentId) {
      return activeParentId
    }
    return parentIds[parentIds.length - 1] ?? null
  },
)

/** downloadId の末尾 `-p(\d+)$` からパート番号（1-based）を抽出する。 */
function extractPartIndex(downloadId: string): number | null {
  const m = downloadId.match(/-p(\d+)$/)
  return m ? parseInt(m[1], 10) : null
}

/** 1ダウンロードの progress を audio/video/merge 個別に返す。 */
function pickStageData(entries: Progress[]): {
  percentage: number
  audio: import('./types').StageProgress
  video: import('./types').StageProgress
  merge: import('./types').StageProgress
  isRetrying: boolean
  stage?: string
  isComplete: boolean
} {
  if (entries.length === 0) {
    return {
      percentage: 0,
      audio: null,
      video: null,
      merge: null,
      isRetrying: false,
      isComplete: false,
    }
  }
  const complete = entries.find((p) => p.stage === 'complete')
  if (complete) {
    return {
      percentage: 100,
      audio: null,
      video: null,
      merge: null,
      isRetrying: complete.isRetrying ?? false,
      stage: 'complete',
      isComplete: true,
    }
  }
  const byStage = (stage: string) =>
    entries.find((p) => p.stage === stage && !p.isComplete)
  const audio = byStage('audio')
  const video = byStage('video')
  const merge = byStage('merge')
  const audioPct = audio?.percentage ?? (merge ? 100 : 0)
  const videoPct = video?.percentage ?? (merge ? 100 : 0)
  const mergePct = merge?.percentage ?? 0
  return {
    percentage: (audioPct + videoPct + mergePct) / 3,
    audio: audio
      ? { percentage: audio.percentage, transferRate: audio.transferRate }
      : null,
    video: video
      ? { percentage: video.percentage, transferRate: video.transferRate }
      : null,
    merge: merge
      ? { percentage: merge.percentage, transferRate: merge.transferRate }
      : null,
    isRetrying:
      (audio?.isRetrying ?? false) ||
      (video?.isRetrying ?? false) ||
      (merge?.isRetrying ?? false),
    stage: merge ? 'merge' : 'download',
    isComplete: false,
  }
}

/**
 * 各パートの状況を行モデルの配列で返す（partIndex 昇順）。
 *
 * queue の子アイテムと progress エントリを統合し、
 * partInputs からパート名を結合する。
 */
export const selectPartStatusRows = createSelector(
  [
    selectResolvedParentId,
    (state: RootState) => state.queue,
    (state: RootState) => state.progress,
    (state: RootState) => state.input.partInputs,
  ],
  (parentId, queue, progress, partInputs): PartStatusRowModel[] => {
    if (!parentId) return []
    const children = queue.filter((q) => q.parentId === parentId)
    return children
      .map((child): PartStatusRowModel | null => {
        const partIndex = extractPartIndex(child.downloadId)
        if (partIndex == null) return null
        const progressEntries = progress.filter(
          (p) => p.downloadId === child.downloadId,
        )
        const rep = pickStageData(progressEntries)
        // partInputs is 0-based; partIndex is 1-based
        const title = partInputs[partIndex - 1]?.title ?? `Part ${partIndex}`
        // @why: When cancel-all lands right after a merge finishes, child.status
        //   becomes 'cancelled' even though the file is actually complete. Override
        //   to 'done' when isComplete so the display matches the real artifact —
        //   this keeps the PartStatusRow dot/strikethrough and OverallSummary
        //   completedCount free of a contradictory "cancelled but complete" state.
        const status = rep.isComplete ? 'done' : (child.status ?? 'pending')
        return {
          downloadId: child.downloadId,
          partIndex,
          title,
          status,
          errorMessage: child.errorMessage,
          percentage: rep.percentage,
          audio: rep.audio,
          video: rep.video,
          merge: rep.merge,
          isRetrying: rep.isRetrying,
          stage: rep.stage,
          isComplete: rep.isComplete,
        }
      })
      .filter((row): row is PartStatusRowModel => row !== null)
      .sort((a, b) => a.partIndex - b.partIndex)
  },
)

/** ダイアログヘッダーの全体サマリ。 */
export const selectOverallSummary = createSelector(
  [
    selectResolvedParentId,
    selectPartStatusRows,
    (state: RootState) => state.queue,
  ],
  (parentId, rows, queue): OverallSummary => {
    // Exclude cancelled parts from totals/progress: they won't download, so
    // counting them in the denominator reads as "still pending" (e.g. 7/10
    // with 3 cancelled looks like 3 are left). cancelledCount is still
    // reported separately for display.
    const active = rows.filter((r) => r.status !== 'cancelled')
    const totalParts = active.length
    const completedCount = active.filter((r) => r.status === 'done').length
    const errorCount = active.filter((r) => r.status === 'error').length
    const cancelledCount = rows.length - active.length
    const activeCount = active.filter(
      (r) => r.status === 'running' || r.status === 'pending',
    ).length
    // Average progress ratio over non-cancelled parts (done=1, otherwise
    // percentage/100).
    const overallRatio =
      totalParts > 0
        ? active.reduce(
            (sum, r) => sum + (r.status === 'done' ? 1 : r.percentage / 100),
            0,
          ) / totalParts
        : 0

    // Calculate wall-clock time based on parent download timestamps.
    // For parallel downloads (audio + video), we use the parent's actual
    // start/completion times instead of summing stage elapsed times.
    let elapsedSeconds = 0
    if (parentId) {
      const parent = queue.find((q) => q.downloadId === parentId)
      if (parent?.startedAtMs) {
        const endTime = parent.completedAtMs ?? Date.now()
        elapsedSeconds = Math.max(0, (endTime - parent.startedAtMs) / 1000)
      }
    }

    // Any part in the merge stage blocks cancel-all: ffmpeg is a CLI
    // process that's unsafe to interrupt mid-merge.
    // @why: The merge stage runs an ffmpeg CLI child process. Cancelling kills
    //   the child, but if the cancel arrives in the brief window right after
    //   ffmpeg reaches `progress=end`, it exits successfully and the output file
    //   is already complete (see src-tauri/src/handlers/ffmpeg.rs merge_avs
    //   "don't discard a finished file", commit d9202270). This actually caused
    //   a contradictory "cancelled yet complete progress emitted" display.
    // @constraint: Fully closing that race window in the backend is hard, so the
    //   safest and simplest fix is to refuse cancel-all while any part is
    //   merging (disable the button).
    const isMerging = rows.some(
      (r) => r.status === 'running' && r.stage === 'merge',
    )
    return {
      totalParts,
      completedCount,
      errorCount,
      cancelledCount,
      activeCount,
      hasActive: activeCount > 0,
      isMerging,
      overallRatio,
      elapsedSeconds,
    }
  },
)
