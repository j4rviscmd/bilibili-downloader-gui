import type { Progress } from '@/shared/ui/Progress'

import type { ExpectedStages } from './types'

/** Per-stage (audio/video/merge) progress view. null = not started/finished. */
export type StageProgress = {
  percentage: number
  transferRate: number
} | null

/** Default expectation: a normal DASH download runs all three stages. */
export const ALL_STAGES: ExpectedStages = {
  audioStage: true,
  mergeStage: true,
}

/**
 * Share of the overall bar owned by the ffmpeg merge stage (0.1 = 10%).
 *
 * Why so small: the common `-c:a copy` remux finishes in seconds, so the
 * old equal-thirds split capped downloaded bytes at ~67% of the bar for
 * the whole transfer. Why not zero: with no merge share the bar pins at
 * 100% while ffmpeg still runs (issue #446), and the AAC fallback
 * re-encode can run for minutes (issues #492/#586).
 */
const MERGE_SHARE = 0.1

/**
 * Merges the progress entries of one download into per-stage views plus an
 * overall percentage.
 *
 * Moved from `features/video/model/downloadProgress.ts` (issue #691): the
 * queue domain now owns every consumer (/downloads rows, bottom bar
 * summary), so the merge lives beside the queue state it reads.
 *
 * @param entries - Progress entries for one downloadId
 * @param expected - Which stages this download runs (snapshotted at enqueue
 *   time on the queue item). Weights the bar by stage shares (merge =
 *   MERGE_SHARE, the rest split evenly between audio and video) so silent
 *   sources (no audio) and durl downloads (muxed, no merge) are not pinned
 *   below 100% (issue #446).
 */
export function pickStageData(
  entries: Progress[],
  expected: ExpectedStages = ALL_STAGES,
): {
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
  // Why merge-fallback first: it is the SAME ffmpeg merge stage after the
  // lossless -c:a copy path failed and the backend fell back to AAC
  // re-encoding (src-tauri/src/handlers/ffmpeg.rs). The fallback switch
  // resets bytes to 0, leaving the old 'merge' entry stale near 0% — the
  // ticking fallback entry must win so the bar keeps moving during a long
  // re-encode.
  const merge =
    entries.find((p) => p.stage === 'merge-fallback' && !p.isComplete) ??
    byStage('merge')
  const subtitle = byStage('subtitle')
  const audioPct = audio?.percentage ?? (merge ? 100 : 0)
  const videoPct = video?.percentage ?? (merge ? 100 : 0)
  const mergePct = merge?.percentage ?? 0
  const mergeShare = expected.mergeStage ? MERGE_SHARE : 0
  // Remaining share split evenly between video and (if expected) audio.
  const streamShare = (1 - mergeShare) / (expected.audioStage ? 2 : 1)
  return {
    percentage:
      (expected.audioStage ? streamShare * audioPct : 0) +
      streamShare * videoPct +
      mergeShare * mergePct,
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
