import { Toaster as Sonner, type ToasterProps } from 'sonner'

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          // Ensure toasts render above dialogs (z-50) and other overlays.
          zIndex: 9999,
          // @why: Radix Dialog (modal) sets pointer-events: none on body
          //   siblings while open, disabling Sonner's portal. Force auto so
          //   swipe-to-dismiss and the close button stay clickable above
          //   open dialogs (e.g. DownloadStatusDialog).
          pointerEvents: 'auto',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
