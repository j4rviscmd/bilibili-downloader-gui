import i18n from '@/i18n'

/**
 * Utility functions for the watch history feature.
 *
 * @module features/watch-history/lib/utils
 */

/**
 * Formats a Unix timestamp to a relative time string with i18n support.
 *
 * @param timestamp - Unix timestamp in seconds
 * @returns Relative time string (e.g., "37分前", "Just now")
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp * 1000

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  const t = i18n.t.bind(i18n)

  if (days > 0) return t('watchHistory.time.daysAgo', { count: days })
  if (hours > 0) return t('watchHistory.time.hoursAgo', { count: hours })
  if (minutes > 0) return t('watchHistory.time.minutesAgo', { count: minutes })
  return t('watchHistory.time.justNow')
}

/**
 * Formats duration in seconds to human-readable format with i18n support.
 *
 * @param seconds - Duration in seconds
 * @returns Formatted duration string (e.g., "1時間51分", "5:30")
 */
export function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  const t = i18n.t.bind(i18n)

  if (hrs > 0) {
    return t('watchHistory.time.durationHMS', {
      hours: hrs,
      minutes: mins,
      seconds: secs,
    })
  }
  return t('watchHistory.time.durationMS', {
    minutes: mins,
    seconds: secs,
  })
}

/**
 * Formats duration in seconds to short hh:mm:ss format.
 *
 * @param seconds - Duration in seconds
 * @returns Formatted duration string (e.g., "1:51:53", "5:30")
 */
export function formatDurationShort(seconds: number): string {
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Calculates progress percentage.
 *
 * @param progress - Current progress in seconds
 * @param duration - Total duration in seconds
 * @returns Progress percentage (0-100)
 */
export function calculateProgress(progress: number, duration: number): number {
  if (duration <= 0) return 0
  return Math.min(100, Math.max(0, (progress / duration) * 100))
}
