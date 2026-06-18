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
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
