/**
 * ManualCookieForm Component
 *
 * Textarea + apply button for pasting a raw Cookie header string (or JSON
 * object) copied from browser DevTools. The backend verifies the cookie via
 * the nav API before storing it, so a failed apply never disturbs the
 * current login state. On success the pasted text is cleared from the
 * field (the value now lives only in the encrypted session file).
 *
 * @module ManualCookieForm
 */

import { Spinner } from '@/components/ui/spinner'
import { useUser } from '@/features/user'
import { logger } from '@/shared/lib/logger'
import { mapBackendError } from '@/shared/lib/mapBackendError'
import { Button } from '@/shared/ui/button'
import { Textarea } from '@/shared/ui/textarea'
import { ClipboardPaste } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { applyManualCookie } from '../api/loginApi'

/**
 * ManualCookieForm component props.
 */
export type ManualCookieFormProps = {
  /** Called after the pasted cookie was verified and stored. */
  onApplied?: () => void
}

/**
 * Renders the manual cookie paste form.
 *
 * @returns The paste UI (textarea, apply button, error line). Deliberately
 *   not a <form> — see the CAUTION note on `handleApply`.
 */
export function ManualCookieForm({ onApplied }: ManualCookieFormProps) {
  const { t } = useTranslation()
  const { getUserInfo } = useUser()
  const [text, setText] = useState('')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [rawError, setRawError] = useState<string | null>(null)
  const [isApplying, setIsApplying] = useState(false)

  // CAUTION: no <form> wrapper here on purpose. In the settings dialog this
  // component lives inside the shadcn <Form> element, and nested <form>s are
  // invalid HTML — WebKit skips the inner onSubmit handler and performs a
  // native GET submission, reloading the whole page. A plain container plus
  // a type="button" click handler avoids that entirely.
  const handleApply = async () => {
    if (isApplying || !text.trim()) return

    setIsApplying(true)
    setErrorKey(null)
    setRawError(null)
    try {
      await applyManualCookie(text)
      // Clear the field: the secret now lives only in the encrypted
      // session file (.session.enc). Keeping it has no real value — after
      // an actual expiry the browser issues a NEW cookie, so the old text
      // can never be successfully re-applied; it would only linger as
      // plaintext in component state.
      setText('')
      // Refresh the app-wide user state so the AppBar reflects the login
      // without a restart (the backend already verified the cookie, so a
      // refresh failure is logged and ignored).
      try {
        await getUserInfo()
      } catch (e) {
        logger.error('ManualCookieForm: getUserInfo after apply failed', e)
      }
      onApplied?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const mapped = mapBackendError(message)
      if (mapped) {
        setErrorKey(mapped)
      } else {
        setRawError(message)
      }
      logger.error('Manual cookie apply failed', error)
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs">
        {t('login.manualCookieHowTo')}
      </p>
      {/* Fixed height + internal scroll: a real Cookie header is one very
          long line and the default `field-sizing-content` auto-grow would
          stretch the textarea past the dialog bounds. Shown in plain text:
          the field clears right after a successful apply, so the value is
          only visible during the brief paste-and-verify moment. */}
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={t('login.manualCookiePlaceholder')}
        spellCheck={false}
        autoComplete="off"
        className="field-sizing-fixed h-28 max-h-28 resize-none overflow-y-auto font-mono text-xs"
        aria-label={t('login.manualCookie')}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {t('login.manualCookieHint')}
        </p>
        {/* CAUTION: while applying, do NOT use the `disabled` attribute.
            `disabled:opacity-50` promotes the translucent button into an
            opacity compositing layer and WKWebView paints it as an opaque
            (non-transparent) box for the whole async window. Instead:
            pointer-events-none + aria-disabled + the handler guard, which
            keep the normal translucent look. The empty-text case keeps
            using `disabled` since no animation runs there. */}
        <Button
          type="button"
          size="sm"
          onClick={handleApply}
          disabled={!text.trim()}
          aria-disabled={isApplying || undefined}
          className={isApplying ? 'pointer-events-none' : undefined}
        >
          {/* CAUTION: keep the label constant while applying. Swapping the
              label next to the animated icon makes WKWebView double-paint
              the text (ghost copy ~1px offset) for the whole async window.
              The spinner alone conveys progress. */}
          {isApplying ? (
            <Spinner />
          ) : (
            <ClipboardPaste className="size-4" aria-hidden="true" />
          )}
          {t('login.manualCookieApply')}
        </Button>
      </div>
      {errorKey && (
        <p className="text-destructive text-sm" role="alert">
          {t(errorKey)}
        </p>
      )}
      {rawError && (
        <p className="text-destructive text-sm" role="alert">
          {rawError}
        </p>
      )}
    </div>
  )
}

export default ManualCookieForm
