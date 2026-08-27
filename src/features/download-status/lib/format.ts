/**
 * Returns a finite number, or `fallback` when the value is missing/NaN/Infinity.
 *
 * Progress events from the backend can omit `transferRate`/`percentage` during
 * CDN rotation and stream errors. Calling `Number#toFixed` on those values
 * throws and whitescreens the whole app via the root ErrorBoundary.
 */
export function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * KB/s を KB/s または MB/s にフォーマットする。
 * PartDownloadProgress の formatTransferRate と同一ロジック。
 */
export function formatTransferRate(kb: unknown): string {
  const n = finiteNumber(kb)
  if (n < 1000) return `${n.toFixed(0)}KB/s`
  return `${(n / 1024).toFixed(1)}MB/s`
}

/**
 * Formats a 0–100 percentage for display, coercing invalid values to 0.
 */
export function formatPercent(value: unknown): string {
  const n = Math.min(100, Math.max(0, Math.round(finiteNumber(value))))
  return String(n)
}

/**
 * 秒数を M:SS または H:MM:SS 形式にフォーマットする。
 */
export function formatElapsed(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`
  return `${m}:${pad(sec)}`
}
