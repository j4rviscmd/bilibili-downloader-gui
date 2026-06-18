/**
 * KB/s を KB/s または MB/s にフォーマットする。
 * PartDownloadProgress の formatTransferRate と同一ロジック。
 */
export function formatTransferRate(kb: number): string {
  if (kb < 1000) return `${kb.toFixed(0)}KB/s`
  return `${(kb / 1024).toFixed(1)}MB/s`
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
