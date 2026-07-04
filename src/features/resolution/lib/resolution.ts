/**
 * Pure-function helpers for resolution preset selection.
 *
 * Kept free of React/i18n so they can be unit-tested in isolation. The UI
 * layer calls {@link getEnabledResolutions} to decide which presets are
 * selectable (presets that would up-scale the source are disabled) and
 * {@link selectBestEffortResolution} to auto-pick a sensible default.
 */

/**
 * Selectable target-height presets in descending order. Mirrors the common
 * "720p / 480p / 360p" shorthand: the numeric value is the height in pixels
 * and the width is auto-calculated by ffmpeg's `scale=-2:H` filter.
 */
export const RESOLUTION_HEIGHT_PRESETS = [1080, 720, 480, 360] as const

export type ResolutionHeightPreset = (typeof RESOLUTION_HEIGHT_PRESETS)[number]

/**
 * Default target height used when the source resolution cannot be probed.
 */
export const DEFAULT_TARGET_HEIGHT: ResolutionHeightPreset = 720

/**
 * The smallest preset, always kept selectable as a floor even when the source
 * is shorter — so the UI never ends up with every preset disabled.
 */
export const MIN_TARGET_HEIGHT: ResolutionHeightPreset =
  RESOLUTION_HEIGHT_PRESETS[RESOLUTION_HEIGHT_PRESETS.length - 1]

/**
 * Returns the presets selectable for a given source height.
 *
 * Presets taller than the source are excluded because up-scaling cannot
 * improve quality (the output can never look sharper than the source) and
 * only wastes file size. The smallest preset is always included as a floor so
 * conversion is never blocked entirely. Pass `null` when the source height is
 * unknown: all presets become selectable.
 *
 * @param sourceHeight - Source video height in pixels, or `null` if unknown
 * @returns Presets the user is allowed to pick
 */
export function getEnabledResolutions(
  sourceHeight: number | null,
): readonly ResolutionHeightPreset[] {
  if (sourceHeight === null) return RESOLUTION_HEIGHT_PRESETS
  return RESOLUTION_HEIGHT_PRESETS.filter(
    (preset) => preset === MIN_TARGET_HEIGHT || preset <= sourceHeight,
  )
}

/**
 * Picks the best-effort default target height for a given source height.
 *
 * Selects the largest preset that does not exceed the source height, so the
 * output stays as close to the source resolution as possible without
 * up-scaling. Falls back to the floor preset when the source is shorter than
 * every preset. Returns the configured default when the source height is
 * unknown.
 *
 * @param sourceHeight - Source video height in pixels, or `null` if unknown
 * @returns The recommended preset to pre-select
 */
export function selectBestEffortResolution(
  sourceHeight: number | null,
): ResolutionHeightPreset {
  if (sourceHeight === null) return DEFAULT_TARGET_HEIGHT
  for (const preset of [...RESOLUTION_HEIGHT_PRESETS].reverse()) {
    if (preset <= sourceHeight) return preset
  }
  return MIN_TARGET_HEIGHT
}
