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
  elapsedTime: number
} {
  if (entries.length === 0) {
    return {
      percentage: 0,
      audio: null,
      video: null,
      merge: null,
      isRetrying: false,
      isComplete: false,
      elapsedTime: 0,
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
      // Sum ALL entries so completion doesn't lose audio+video time.
      elapsedTime: entries.reduce((sum, e) => sum + (e.elapsedTime ?? 0), 0),
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
    // Sum ALL stage elapsed times (audio + video + merge) for the total.
    // Look at all entries including completed ones so earlier stages
    // aren't lost when a later stage starts.
    elapsedTime: entries.reduce((sum, e) => sum + (e.elapsedTime ?? 0), 0),
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
        return {
          downloadId: child.downloadId,
          partIndex,
          title,
          status: child.status ?? 'pending',
          errorMessage: child.errorMessage,
          percentage: rep.percentage,
          audio: rep.audio,
          video: rep.video,
          merge: rep.merge,
          isRetrying: rep.isRetrying,
          stage: rep.stage,
          isComplete: rep.isComplete,
          elapsedTime: rep.elapsedTime,
        }
      })
      .filter((row): row is PartStatusRowModel => row !== null)
      .sort((a, b) => a.partIndex - b.partIndex)
  },
)

/** ダイアログヘッダーの全体サマリ。 */
export const selectOverallSummary = createSelector(
  [selectPartStatusRows],
  (rows): OverallSummary => {
    const totalParts = rows.length
    const completedCount = rows.filter((r) => r.status === 'done').length
    const errorCount = rows.filter((r) => r.status === 'error').length
    const cancelledCount = rows.filter((r) => r.status === 'cancelled').length
    const activeCount = rows.filter(
      (r) => r.status === 'running' || r.status === 'pending',
    ).length
    // Average of per-part progress ratios (done=1, cancelled=0, otherwise
    // percentage/100). Cancelled parts freeze at 0 so a still-running backend
    // download doesn't move the overall bar.
    const overallRatio =
      totalParts > 0
        ? rows.reduce((sum, r) => {
            let ratio: number
            if (r.status === 'done') ratio = 1
            else if (r.status === 'cancelled') ratio = 0
            else ratio = r.percentage / 100
            return sum + ratio
          }, 0) / totalParts
        : 0
    // Sum elapsed times across all non-cancelled parts. Serial downloads
    // run one after another, so total wall-clock time = sum of each part's
    // elapsed time.
    const elapsedSeconds = rows.reduce(
      (sum, r) => (r.status === 'cancelled' ? sum : sum + r.elapsedTime),
      0,
    )
    return {
      totalParts,
      completedCount,
      errorCount,
      cancelledCount,
      activeCount,
      hasActive: activeCount > 0,
      overallRatio,
      elapsedSeconds,
    }
  },
)
