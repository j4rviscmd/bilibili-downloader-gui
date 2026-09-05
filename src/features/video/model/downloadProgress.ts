import { createSelector } from '@reduxjs/toolkit'

import type { RootState } from '@/app/store'
import type { QueueItem } from '@/shared/queue/queueSlice'
import type { Progress } from '@/shared/ui/Progress'

/**
 * Download progress view-model for the inline (home page) download UI.
 *
 * Merges the shared `queue` and `progress` slices with the video input
 * (part titles) into per-part row models plus an overall summary, and
 * derives which part the compact cards should auto-expand.
 *
 * Moved from the former `features/download-status` feature when its modal
 * dialog was abolished (issue #569); logic is unchanged except that the
 * dialog-only `activeParentId` pin is gone — the resolved parent is always
 * the most recently enqueued one.
 */

/** パートのDLステータス。queueSlice の QueueItemStatus から導出する。 */
export type DownloadPartStatus = NonNullable<QueueItem['status']>

/** 個別ステージ（audio/video/merge）の進捗。null = 未開始/完了 */
export type StageProgress = {
  percentage: number
  transferRate: number
} | null

/**
 * 1パート分のDL状況（コンパクト行/展開詳細の表示モデル）。
 *
 * `queue` の子アイテムと、その downloadId に紐づく `progress`
 * エントリを統合した表示用モデル。
 */
export type PartStatusRowModel = {
  /** 子ダウンロードID（{parentId}-p{partIndex}） */
  downloadId: string
  /** パート番号（1-based）。downloadId の -p(\d+)$ から抽出 */
  partIndex: number
  /** パート名（input.partInputs の title） */
  title: string
  /** キューのステータス（pending/running/cancelling/cancelled/done/error） */
  status: DownloadPartStatus
  /** エラーメッセージ（status === 'error' のとき） */
  errorMessage?: string
  /** 全体進捗 0-100（3ステージ均等: overall = (audioPct + videoPct + mergePct) / 3） */
  percentage: number
  /** audio ステージ進捗（null = 未開始/完了） */
  audio: StageProgress
  /** video ステージ進捗（null = 未開始/完了） */
  video: StageProgress
  /** merge ステージ進捗（null = 未開始/完了） */
  merge: StageProgress
  /** CDN切り替え等のリトライ中か */
  isRetrying: boolean
  /** 現在ステージ（download/merge/complete） */
  stage?: string
  /** 完了しているか（progress の complete ステージ有無） */
  isComplete: boolean
}

/** 全体サマリ（進捗バー + 完了数 + 経過時間の表示モデル）。 */
export type OverallSummary = {
  /** 対象親の全パート数 */
  totalParts: number
  /** status === 'done' の件数 */
  completedCount: number
  /** status === 'error' の件数 */
  errorCount: number
  /** status === 'cancelled' の件数 */
  cancelledCount: number
  /** running + pending の件数 */
  activeCount: number
  /** 何らかのDLが進行中か */
  hasActive: boolean
  /**
   * True when any part is currently merging (ffmpeg CLI running). Blocks cancel-all.
   *
   * @why The merge stage spawns an ffmpeg CLI child process to combine video
   *   and audio. Cancelling must kill that child, but if the cancel arrives in
   *   the brief window right after ffmpeg reaches `progress=end` (done), the
   *   process exits successfully and the output file is already complete. This
   *   follows the "don't discard a finished file" intent in
   *   `src-tauri/src/handlers/ffmpeg.rs` `merge_avs` (commit d9202270). It
   *   actually caused a contradictory "cancelled yet complete progress emitted"
   *   UI state.
   * @constraint Fully closing that race window in the backend is hard, so the
   *   safest and simplest workaround is to refuse cancel-all while any part is
   *   merging (disable the button).
   */
  isMerging: boolean
  /** 全体進捗 0..1（完了=1、進行中=percentage/100 の平均） */
  overallRatio: number
  /**
   * Elapsed time in seconds — real wall-clock time from the parent download's
   * start to its completion (or now if still active).
   *
   * @why Derived from the parent QueueItem's startedAtMs/completedAtMs, not by
   *   summing per-stage elapsed times. audio and video stages run in parallel
   *   (tokio::try_join! in the backend), so summing their elapsed times would
   *   make this advance at ~2x real time.
   */
  elapsedSeconds: number
}

/**
 * 表示対象の親DL IDを解決する。
 *
 * キュー内の親のうち、最後（直近に enqueue されたもの）を選ぶ。
 * 直列DL前提なので、同時に進行する親は実質1つ。
 *
 * 入力に state.queue（参照安定）を直接使う。新配列を返す入力セレクタを
 * 挟むと createSelector のメモ化が実質無効化するため。
 */
export const selectResolvedParentId = createSelector(
  [(state: RootState) => state.queue],
  (queue) => {
    const parentIds = [
      ...new Set(
        queue.map((q) => q.parentId).filter((id): id is string => id != null),
      ),
    ]
    return parentIds[parentIds.length - 1] ?? null
  },
)

/** downloadId の末尾 `-p(\d+)$` からパート番号（1-based）を抽出する。 */
function extractPartIndex(downloadId: string): number | null {
  const m = downloadId.match(/-p(\d+)$/)
  return m ? parseInt(m[1], 10) : null
}

/** 1ダウンロードの progress を audio/video/merge 個別に返す。 */
export function pickStageData(entries: Progress[]): {
  percentage: number
  audio: StageProgress
  video: StageProgress
  merge: StageProgress
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
  const subtitle = byStage('subtitle')
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
    // @why: merge takes precedence over subtitle. The subtitle entry lingers
    //   in state after the subtitle download finishes (it is never re-emitted
    //   or cleared), so if subtitle won, the merge stage would be skipped and
    //   the row would jump straight from "subtitle downloading" to "complete".
    //   Prioritizing merge lets the merge stage render once ffmpeg starts.
    stage: merge ? 'merge' : subtitle ? 'subtitle' : 'download',
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
        //   this keeps the compact row dot/strikethrough and OverallSummary
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

/** 全体サマリ（進捗バー + 完了数 + 経過時間 + cancel-all ガード）。 */
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

/**
 * 展開すべきパート番号（1-based）。running があればそれ、無ければ最初の
 * pending。どちらも無ければ null。
 *
 * @why pending fallback keeps the expansion stable across the part-to-part
 *   handover: when part N finishes, part N+1 is already pending, so the
 *   expanded row switches instantly instead of collapsing and re-expanding.
 *   Returns a primitive so per-part subscribers (VideoPartCard) only
 *   re-render when the expanded part actually changes — never on every
 *   progress tick (do not subscribe cards to selectPartStatusRows; its array
 *   identity changes per tick).
 */
export const selectActivePartIndex = createSelector(
  [selectPartStatusRows],
  (rows): number | null => {
    const running = rows.find((r) => r.status === 'running')
    if (running) return running.partIndex
    return rows.find((r) => r.status === 'pending')?.partIndex ?? null
  },
)
