import type { PartInput } from '@/features/video/types'
import type { QueueItemStatus } from '@/shared/queue'

/**
 * Download progress model helpers for the video feature.
 *
 * The queue-facing halves of the old module (pickStageData, per-part row
 * models, the overall summary, the compact-card auto-follow selector)
 * moved to the queue domain (`shared/queue/stages.ts`,
 * `shared/queue/selectors.ts`) when the download queue landed (issue #691)
 * — /downloads and the bottom bar read them there. What remains here is
 * the one piece tied to `state.input`: computing which stages a part will
 * run, at ENQUEUE time.
 */

/** Status label type shared with the queue items (badge/status visuals). */
export type DownloadPartStatus = QueueItemStatus

/** Which download stages a part actually runs (issue #446). */
export type StageExpectations = {
  /** Audio stream download runs (false: silent source or durl muxed file) */
  audioStage: boolean
  /** ffmpeg merge/remux runs (false: durl saves bytes directly) */
  mergeStage: boolean
}

/** Default expectation: a normal DASH download runs all three stages. */
export const ALL_STAGES: StageExpectations = {
  audioStage: true,
  mergeStage: true,
}

/**
 * Derives the stage expectations from a part's input state.
 *
 * - Silent source (`audioAbsent`, issue #446): video + merge only.
 * - durl (embedded audio — resolved `audioQuality: null`, or a qualities
 *   fetch that returned an empty audio list): single muxed download, no
 *   merge.
 * - Unknown shape (qualities not loaded yet): assume all stages so the
 *   percentage never over-reports before the shape is known.
 */
export function stageExpectations(
  part: PartInput | undefined,
): StageExpectations {
  if (!part) return ALL_STAGES
  const silent = part.audioAbsent === true
  // Why: silent sources also resolve `audioQuality: null` (the backend has no
  // audio id to report), so `!audioAbsent` is what separates them from durl —
  // misclassifying silent as durl would drop the merge stage from the divisor
  // and pin the bar at 100% while the remux runs (issue #446).
  const durl = part.resolvedQuality
    ? part.resolvedQuality.audioQuality === null &&
      !part.resolvedQuality.audioAbsent
    : part.audioQualities !== undefined &&
      part.audioQualities.length === 0 &&
      !silent
  return { audioStage: !silent && !durl, mergeStage: !durl }
}
