/**
 * Duration formatting utilities for the resolution feature.
 */

/**
 * Formats a duration in seconds to a human-readable string.
 *
 * @param sec - Duration in seconds
 * @returns Formatted duration string (e.g. "01:23", "1:45:30")
 */
export function formatDuration(sec: number): string {
  const hours = Math.floor(sec / 3600)
  const minutes = Math.floor((sec % 3600) / 60)
  const seconds = Math.floor(sec % 60)

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
