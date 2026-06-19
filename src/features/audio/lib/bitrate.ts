/**
 * Pure-function helpers for audio bitrate preset selection.
 *
 * Kept free of React/i18n so they can be unit-tested in isolation. The UI
 * layer calls {@link getEnabledPresets} to decide which presets are
 * selectable and {@link selectBestEffortBitrate} to auto-pick a default.
 */

/**
 * Selectable bitrate presets in ascending order.
 */
export const BITRATE_PRESETS = [128, 192, 256, 320] as const

export type BitratePreset = (typeof BITRATE_PRESETS)[number]

/**
 * Default bitrate used when the input audio bitrate cannot be determined
 * (e.g. VBR streams). Matches the issue's default of 192 kbps.
 */
export const DEFAULT_BITRATE_KBPS: BitratePreset = 192

/**
 * The lowest preset, always kept selectable as a floor even when the input
 * bitrate is below it — so the UI never ends up with every option disabled.
 */
export const MIN_BITRATE_KBPS: BitratePreset = BITRATE_PRESETS[0]

/**
 * Returns the bitrate presets that should be selectable for a given input
 * audio bitrate.
 *
 * Presets that exceed the input bitrate are excluded because lossy
 * up-conversion only wastes space (the output can never sound better than
 * the source). The smallest preset is always included as a floor so
 * extraction is never blocked entirely. Pass `null` when the input bitrate
 * is unknown (VBR): all presets become selectable.
 *
 * @param inputBitrate - Source audio bitrate in kbps, or `null` if unknown
 * @returns Presets the user is allowed to pick
 */
export function getEnabledPresets(
  inputBitrate: number | null,
): readonly BitratePreset[] {
  if (inputBitrate === null) return BITRATE_PRESETS
  return BITRATE_PRESETS.filter(
    (preset) => preset === MIN_BITRATE_KBPS || preset <= inputBitrate,
  )
}

/**
 * Picks the best-effort default bitrate for a given input audio bitrate.
 *
 * Selects the largest preset that does not exceed the input bitrate, so the
 * output stays as close to the source quality as possible without wasting
 * bits. Falls back to the floor preset when the input is below every preset.
 * Returns the configured default when the input bitrate is unknown.
 *
 * @param inputBitrate - Source audio bitrate in kbps, or `null` if unknown
 * @returns The recommended preset to pre-select
 */
export function selectBestEffortBitrate(
  inputBitrate: number | null,
): BitratePreset {
  if (inputBitrate === null) return DEFAULT_BITRATE_KBPS
  for (const preset of [...BITRATE_PRESETS].reverse()) {
    if (preset <= inputBitrate) return preset
  }
  return MIN_BITRATE_KBPS
}
