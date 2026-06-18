import type { QueueItem } from '@/shared/queue/queueSlice'

/**
 * パートのDLステータス。
 * queueSlice の QueueItemStatus は export されていないため、
 * QueueItem['status'] から導出する。
 */
export type DownloadPartStatus = NonNullable<QueueItem['status']>

/** 個別ステージ（audio/video/merge）の進捗。null = 未開始/完了 */
export type StageProgress = {
  percentage: number
  transferRate: number
} | null

/**
 * 1パート分のDL状況（ダイアログの1行に対応）。
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
  /** 経過時間 秒 */
  elapsedTime: number
}

/**
 * ダイアログヘッダーの全体サマリ。
 *
 * 直列DL前提で、全体進捗バーと完了数の表示に使う。
 */
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
  /** 経過時間 秒（全子の max(elapsedTime)） */
  elapsedSeconds: number
}

/**
 * ダイアログ開閉状態。
 *
 * `activeParentId` は表示対象の親DL ID。
 * null のときは selector が直近のアクティブ親を解決する。
 */
export type DownloadStatusDialogState = {
  dialogOpen: boolean
  activeParentId: string | null
}
