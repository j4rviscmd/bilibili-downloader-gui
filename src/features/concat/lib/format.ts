/**
 * Formats a duration in seconds into a human-readable string.
 *
 * Durations under one hour are rendered as `M:SS`, while durations
 * of an hour or more use `H:MM:SS`. Negative values are clamped to zero.
 *
 * @param seconds - The duration in seconds (may be fractional).
 * @returns A formatted duration string.
 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0)
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}
