import type { CSSProperties } from 'react'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'

type Theme = 'light' | 'dark' | 'colored'

type ToasterProps = {
  theme?: 'light' | 'dark'
  /** Maps to react-toastify's `theme="colored"` (type-colored backgrounds). */
  richColors?: boolean
}

/**
 * App-wide toast container backed by react-toastify.
 *
 * Replaces the previous sonner `<Toaster>`. `richColors` maps to
 * react-toastify's `theme="colored"` (type-colored backgrounds, matching
 * sonner's richColors). The Redux `theme` ('light' | 'dark') is applied
 * when `richColors` is off.
 *
 * CONSTRAINT: position is fixed at bottom-right to preserve the previous
 * sonner default. The progress bar is shown for remaining-time feedback.
 * The close button (x) is disabled app-wide — the Copy button lives
 * inside each toast body (top-right, see `@/shared/ui/toast`), and
 * toasts are dismissed via drag/swipe-to-dismiss.
 *
 * @why: --toastify-toast-width: fit-content lets short messages render
 *   on a single line (sonner-like) instead of wrapping at 320px; the
 *   max-w-[480px] on toastClassName caps long errors from stretching
 *   too wide.
 *
 * @why: --toastify-toast-padding (rem) and --toastify-toast-min-height
 *   (auto) override react-toastify's defaults (14px / 64px) so the toast
 *   hugs its content instead of leaving a large fixed margin around
 *   single-line messages. The padding is rem-based to scale with the
 *   user's fontSize setting (applied on <html>), keeping the toast
 *   visually consistent across font sizes; min-height: auto drops the
 *   64px floor so the content height alone decides the toast height.
 *
 * @why: Radix Dialog (modal) sets pointer-events: none on body siblings
 *   while open, which would disable react-toastify's portal. Force auto
 *   so drag/swipe-to-dismiss and the Copy button stay clickable above
 *   open dialogs (e.g. DownloadStatusDialog). zIndex keeps toasts above
 *   dialogs (z-50) and other overlays.
 *
 * NOTE: `select-none` is applied via `toastClassName` so toast text is
 *   uniformly non-selectable — the per-toast Copy button covers the copy
 *   use case (see `@/shared/ui/toast`).
 */
const Toaster = ({ theme, richColors }: ToasterProps) => {
  const resolvedTheme: Theme = richColors ? 'colored' : (theme ?? 'light')
  return (
    <ToastContainer
      position="bottom-right"
      theme={resolvedTheme}
      closeButton={false}
      newestOnTop={false}
      closeOnClick={false}
      pauseOnFocusLoss
      pauseOnHover
      draggable
      toastClassName="select-none max-w-[480px]"
      style={
        {
          '--toastify-toast-width': 'fit-content',
          '--toastify-toast-padding': '0.5rem',
          '--toastify-toast-min-height': 'auto',
          zIndex: 9999,
          pointerEvents: 'auto',
        } as CSSProperties
      }
    />
  )
}

export { Toaster }
