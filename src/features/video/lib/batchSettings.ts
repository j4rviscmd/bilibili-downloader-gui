import {
  AUDIO_QUALITIES_ORDER,
  VIDEO_QUALITIES_ORDER,
} from '@/features/video/lib/constants'

/**
 * Video quality ladder ids in descending quality order (qn table).
 *
 * Re-exported from constants so batch-settings consumers have a single
 * import point for the ladder plus the resolution helpers below.
 */
export const VIDEO_LADDER_IDS: readonly number[] = VIDEO_QUALITIES_ORDER

/**
 * Audio quality ladder ids in descending quality order.
 */
export const AUDIO_LADDER_IDS: readonly number[] = AUDIO_QUALITIES_ORDER

/**
 * Quality ids that require a logged-in (non-anonymous) session per
 * Bilibili platform rules: 112 = 1080p+, 116 = 1080p60. Used to annotate
 * batch options when the account is logged out.
 */
export const LOGIN_REQUIRED_VIDEO_IDS: ReadonlySet<number> = new Set([112, 116])

/**
 * Quality ids that require a VIP (大会員) membership per Bilibili
 * platform rules. Annotated on batch options as "大会員" — static ladder
 * knowledge, not from the API (the app has no vip status field).
 */
export const VIP_VIDEO_IDS: ReadonlySet<number> = new Set([127, 126, 125, 120])
export const VIP_AUDIO_IDS: ReadonlySet<number> = new Set([30251, 30250])

/**
 * Highest video tier an anonymous (logged-out) session can use: 32 = 480p.
 * Same platform rule the login notice quotes ("画質は480p以下に制限されます").
 * Used by the batch bar's login-state default, which must not depend on
 * per-part fetched ladders (select-all can span hundreds of parts).
 */
export const ANON_MAX_VIDEO_ID = 32

/**
 * Priority (index) of a fetched subtitle language inside the user's
 * selection, or -1 when not selected.
 *
 * Matching normalizes both sides: bilibili emits AI prefixes ("ai-ja"),
 * legacy Chinese codes ("zh-CN"), and region-qualified forms ("en-US")
 * that the fixed selection list never contains. Normalization maps those
 * onto the list's codes — AI prefix stripped, Chinese variants resolved
 * to their script (simplified → zh-Hans, traditional → zh-Hant), and any
 * other region suffix dropped ("en-US" → "en"). Without this, batch
 * soft-sub selections silently matched nothing and downloads embedded no
 * subtitles.
 */
function normalizeLan(lan: string): string {
  const base = lan.replace(/^ai-/, '')
  if (base === 'zh' || base === 'zh-CN') return 'zh-Hans'
  if (base === 'zh-Hant' || base === 'zh-TW' || base === 'zh-HK')
    return 'zh-Hant'
  if (base === 'zh-Hans') return 'zh-Hans'
  // Region-qualified forms (en-US) match their base language; the zh
  // script codes are handled above so the split never touches them.
  return base.split('-')[0] ?? base
}

export function selectedLanPriority(
  selectedLans: readonly string[],
  lan: string,
): number {
  const exact = selectedLans.indexOf(lan)
  if (exact !== -1) return exact
  const norm = normalizeLan(lan)
  return selectedLans.findIndex((s) => normalizeLan(s) === norm)
}

/** True when a fetched subtitle language is covered by the selection. */
export function matchesSelectedLan(
  selectedLans: readonly string[],
  lan: string,
): boolean {
  return selectedLanPriority(selectedLans, lan) >= 0
}

/**
 * Common Bilibili subtitle language codes with display labels.
 *
 * A fixed list shown in the batch dropdown (same full-ladder approach
 * as qualities); languages absent from the selected parts' fetched
 * subtitles render disabled. Native names — not localized — because
 * they identify the content itself (a Japanese speaker selecting
 * "Japanese" sees 日本語 regardless of the app language).
 */
export const SUBTITLE_LANGUAGES: readonly { lan: string; label: string }[] = [
  { lan: 'zh-Hans', label: '中文(简体)' },
  { lan: 'zh-Hant', label: '中文(繁體)' },
  { lan: 'ja', label: '日本語' },
  { lan: 'en', label: 'English' },
  { lan: 'ko', label: '한국어' },
  { lan: 'th', label: 'ไทย' },
  { lan: 'vi', label: 'Tiếng Việt' },
  { lan: 'id', label: 'Bahasa Indonesia' },
  { lan: 'es', label: 'Español' },
  { lan: 'ru', label: 'Русский' },
]

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
