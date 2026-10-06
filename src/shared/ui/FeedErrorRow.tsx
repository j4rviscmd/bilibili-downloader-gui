import { Button } from '@/shared/ui/button'
import { AlertTriangle, RotateCcw } from 'lucide-react'

/**
 * One-line load failure row with a retry button (initial and later-page
 * failures share it; retry re-requests the failed page). Labels are
 * passed in pre-translated so each feature keeps its own i18n namespace.
 */
export function FeedErrorRow({
  error,
  message,
  retryLabel,
  onRetry,
}: {
  /** Raw backend error code/string (screen-reader only, diagnostics). */
  error: string
  /** Translated failure message. */
  message: string
  /** Translated retry button label. */
  retryLabel: string
  onRetry: () => void
}) {
  return (
    <div className="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCcw className="size-4" aria-hidden="true" />
        {retryLabel}
      </Button>
      {/* Raw backend error for diagnostics (not translated). */}
      <span className="sr-only">{error}</span>
    </div>
  )
}
