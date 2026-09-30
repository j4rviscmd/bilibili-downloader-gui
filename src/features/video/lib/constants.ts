/**
 * Mapping of Bilibili video quality IDs to display labels.
 *
 * IDs follow the official playurl `qn` table (120 = 4K, 125 = HDR10,
 * 126 = Dolby Vision, 127 = 8K). 4K / HDR10 / Dolby Vision / 8K require a
 * logged-in VIP (大会員) account and matching `fnval` request bits.
 * Higher numbers generally indicate better quality.
 */
export const VIDEO_QUALITIES_MAP: Record<number, string> = {
  127: '8K',
  126: 'Dolby Vision',
  125: 'HDR10',
  120: '4K',
  116: '1080p60',
  112: '1080p+',
  80: '1080p',
  74: '720p60',
  64: '720p',
  32: '480p',
  16: '360p',
}

/**
 * Video quality display order (descending by quality).
 *
 * Explicit order (mirrors `AUDIO_QUALITIES_ORDER`) so numeric object-key
 * sorting cannot hide 8K / HDR10 / Dolby Vision.
 */
export const VIDEO_QUALITIES_ORDER: number[] = [
  127, 126, 125, 120, 116, 112, 80, 74, 64, 32, 16,
]

/**
 * localStorage key for the video URL input (legacy, currently unused).
 */
export const VIDEO_URL_KEY: string = 'inputUrl'

/**
 * Mapping of Bilibili audio quality IDs to display labels.
 */
export const AUDIO_QUALITIES_MAP: Record<number, string> = {
  30216: '64K',
  30232: '132K',
  30280: '192K',
  30250: 'Dolby Atmos',
  30251: 'Hi-Res Lossless',
}

/**
 * Audio quality display order (descending by quality).
 *
 * Order: Hi-Res Lossless > Dolby Atmos > 192K > 132K > 64K
 */
export const AUDIO_QUALITIES_ORDER: number[] = [
  30251, 30250, 30280, 30232, 30216,
]

/**
 * Audio quality ids to render as options.
 *
 * The fixed ladder keeps its hand-curated quality order — a numeric sort
 * cannot express it (192K's id 30280 is numerically above Hi-Res 30251).
 * Fetched ids outside the ladder (e.g. a Dolby variant like 30255) render
 * above it, numeric descending among themselves: they are VIP tiers the
 * manifest offered, and skipping them would hide a quality the backend
 * offers from selection (issue #713).
 */
export function audioOptionIds(
  audioQualities: readonly { id: number }[] | null | undefined,
): number[] {
  const ladder = new Set(AUDIO_QUALITIES_ORDER)
  const extra = [...new Set((audioQualities ?? []).map((q) => q.id))]
    .filter((id) => !ladder.has(id))
    .sort((a, b) => b - a)
  return [...extra, ...AUDIO_QUALITIES_ORDER]
}

/**
 * Number of parts displayed per page in the paginated part list.
 *
 * Also bounds the default selection when a URL does not identify a
 * specific part/episode: only the first page is selected by default
 * to avoid silently queuing every part of a large series.
 */
export const PARTS_PER_PAGE: number = 10
