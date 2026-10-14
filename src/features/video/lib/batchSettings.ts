import { VIDEO_QUALITIES_ORDER } from '@/features/video/lib/constants'

/**
 * Video quality ladder ids in descending quality order (qn table).
 *
 * Re-exported from constants so batch-settings consumers have a single
 * import point for the ladder plus the resolution helpers below.
 */
export const VIDEO_LADDER_IDS: readonly number[] = VIDEO_QUALITIES_ORDER

/**
 * Quality ids that require a logged-in (non-anonymous) session per
 * Bilibili platform rules: 112 = 1080p+, 116 = 1080p60. Used to annotate
 * batch options when the account is logged out.
 *
 * Why a Set: dynamic membership checks against fetched ids, and the same
 * check runs per option row.
 */
export const LOGIN_REQUIRED_VIDEO_IDS: ReadonlySet<number> = new Set([112, 116])

/**
 * Unions per-part availability into the batch option list, in ladder
 * (descending quality) order.
 *
 * The batch selector is honest about what it can know: availability is
 * per part, so the batch list only offers qualities at least one selected
 * part can use. Ids outside the ladder (unknown manifest extras) are
 * dropped — they have no rank for target resolution.
 *
 * @param ladder - Ordered quality ids, highest first
 * @param perPart - Available ids per selected part (fetched qualities)
 * @returns Unioned ids in ladder order
 */
export function unionIds(
  ladder: readonly number[],
  perPart: readonly (readonly number[] | undefined)[],
): number[] {
  const union = new Set<number>()
  for (const ids of perPart) {
    for (const id of ids ?? []) union.add(id)
  }
  return ladder.filter((id) => union.has(id))
}

/**
 * Resolves a batch target quality against one part's availability:
 * the highest available quality at or below the target. When nothing
 * meets the target, falls back to the lowest available quality —
 * mirroring the existing download-time fallback semantics.
 *
 * @param targetId - Batch target quality id
 * @param availableIds - The part's fetched quality ids
 * @param ladder - Ordered quality ids, highest first
 * @returns The quality id that would actually download
 */
export function resolveTarget(
  targetId: number,
  availableIds: readonly number[],
  ladder: readonly number[],
): number {
  const rank = new Map(ladder.map((id, i) => [id, i]))
  const ranked = availableIds
    .filter((id) => rank.has(id))
    .sort((a, b) => rank.get(a)! - rank.get(b)!)
  if (ranked.length === 0) return targetId
  const targetRank = rank.get(targetId)
  if (targetRank === undefined) return ranked[ranked.length - 1]!
  const atOrBelow = ranked.find((id) => rank.get(id)! >= targetRank)
  return atOrBelow ?? ranked[ranked.length - 1]!
}

/**
 * Predicts whether a part would be auto-adjusted below the batch target
 * (drives the per-row ⚠ pill before download).
 *
 * @param targetId - Batch target quality id
 * @param availableIds - The part's fetched quality ids
 * @param ladder - Ordered quality ids, highest first
 * @returns True when resolution will land below the target
 */
export function predictAdjustment(
  targetId: number,
  availableIds: readonly number[],
  ladder: readonly number[],
): boolean {
  return resolveTarget(targetId, availableIds, ladder) !== targetId
}
