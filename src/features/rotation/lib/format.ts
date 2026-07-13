/**
 * Time formatting helper for the rotation progress UI.
 *
 * Formats a duration in seconds to `M:SS` (or `H:MM:SS` for durations of an
 * hour or longer). Clamps negative input to zero so a transient bad value
 * never renders as `-1:30`.
 *
 * @example
 * ```typescript
 * formatDuration(12.5)   // '0:12'
 * formatDuration(125)    // '2:05'
 * formatDuration(3661)   // '1:01:01'
 * ```
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`
  return `${m}:${pad(s)}`
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}
