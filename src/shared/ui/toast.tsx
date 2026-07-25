import { Check, Copy } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { toast as baseToast, type ToastOptions } from 'react-toastify'

/**
 * Sonner-compatible options that existing call sites already pass. The
 * wrapper translates them to react-toastify equivalents and injects the
 * Copy button (and any action button) into the toast body.
 *
 * CONSTRAINT: call sites pass string titles and (optionally) string
 * descriptions. ReactNode descriptions are not stringified for the
 * clipboard, so keep descriptions as plain strings.
 */
export type ToastOptionsCompat = {
  description?: ReactNode
  action?: { label: string; onClick: () => void }
  duration?: number | false
  id?: string | number
  closeButton?: boolean
}

type Variant = 'success' | 'error' | 'info' | 'warning'

/**
 * Extracts a copyable string from a title/description node. Only plain
 * strings and numbers are handled — every current call site passes
 * strings, so this is sufficient. Non-string nodes yield an empty
 * string and the Copy button is hidden when there is nothing to copy.
 */
function nodeToCopyText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return ''
}

function buildCopyText(title: ReactNode, description?: ReactNode): string {
  const t = nodeToCopyText(title)
  const d = nodeToCopyText(description)
  if (t && d) return `${t}\n${d}`
  return t || d
}

/**
 * Toast body: title, optional description, optional action button, and
 * a Copy icon button absolutely positioned at the top-right. The Copy
 * button copies `copyText` (title + description) to the clipboard. The
 * icon swaps to a check for 2s on success; clipboard failures are
 * ignored silently so they never mask the original message.
 *
 * CONSTRAINT: the title and Copy button share a flex row
 * (`items-center`) so the button aligns with the title's vertical
 * center; description renders below that row. `select-none` is applied
 * globally via `ToastContainer.toastClassName` (see `sonner.tsx`).
 *
 * NOTE: react-toastify's `closeButton` slot does not receive toast
 * `data`, so it cannot access `copyText`. The Copy button therefore
 * lives inside the body (where `copyText` is passed directly) rather
 * than in the `closeButton` slot.
 */
function ToastBody({
  title,
  description,
  action,
  copyText,
}: {
  title: ReactNode
  description?: ReactNode
  action?: { label: string; onClick: () => void }
  copyText: string
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!copyText) return
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard write can fail in some webview contexts; ignore
      // silently rather than masking the original message.
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">{title}</div>
        {copyText && (
          <button
            type="button"
            onClick={handleCopy}
            className="text-foreground shrink-0 opacity-70 transition-opacity hover:opacity-100"
            aria-label={t('common.copy')}
          >
            {copied ? (
              <Check className="size-3.5" />
            ) : (
              <Copy className="size-3.5" />
            )}
          </button>
        )}
      </div>
      {description != null && description !== '' && (
        <div className="text-sm opacity-80">{description}</div>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-1 text-sm font-medium underline-offset-2 hover:underline"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}

function toOptions(
  title: ReactNode,
  opts?: ToastOptionsCompat,
): {
  content: ReactNode
  options: ToastOptions
} {
  const { description, action, duration, id, ...rest } = opts ?? {}
  const copyText = buildCopyText(title, description)
  const content = (
    <ToastBody
      title={title}
      description={description}
      action={action}
      copyText={copyText}
    />
  )
  const autoClose =
    duration === undefined
      ? undefined
      : duration === false || duration === Infinity
        ? false
        : duration
  return {
    content,
    options: {
      ...rest,
      autoClose,
      toastId: id,
    } as ToastOptions,
  }
}

function emit(variant: Variant, title: ReactNode, opts?: ToastOptionsCompat) {
  const { content, options } = toOptions(title, opts)
  return baseToast[variant](content, options)
}

/**
 * Drop-in replacement for sonner's `toast`. Existing call sites only
 * change the import path (`sonner` -> `@/shared/ui/toast`); call
 * signatures `toast.error(title, { description, action, duration, id })`
 * stay identical.
 *
 * Every toast gets a Copy button at the top-right (inside the body)
 * that copies the title and description. Toasts are dismissed via
 * drag/swipe-to-dismiss.
 */
export const toast = {
  success: (title: ReactNode, opts?: ToastOptionsCompat) =>
    emit('success', title, opts),
  error: (title: ReactNode, opts?: ToastOptionsCompat) =>
    emit('error', title, opts),
  info: (title: ReactNode, opts?: ToastOptionsCompat) =>
    emit('info', title, opts),
  warning: (title: ReactNode, opts?: ToastOptionsCompat) =>
    emit('warning', title, opts),
  dismiss: (id?: string | number) => baseToast.dismiss(id),
}
