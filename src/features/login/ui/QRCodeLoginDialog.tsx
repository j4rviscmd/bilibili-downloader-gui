/**
 * QRCodeLoginDialog Component
 *
 * A dialog component that wraps QRCodeDisplay for inline login from the home page.
 * Provides a modal interface for QR code login without page navigation.
 *
 * @module QRCodeLoginDialog
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/animate-ui/radix/dialog'
import { useTranslation } from 'react-i18next'
import { QRCodeDisplay } from './QRCodeDisplay'

/**
 * QRCodeLoginDialog component props.
 */
export type QRCodeLoginDialogProps = {
  /** Whether the dialog is open */
  open: boolean
  /** Callback when dialog open state changes */
  onOpenChange: (open: boolean) => void
}

/**
 * Dialog component for QR code login.
 *
 * Displays QRCodeDisplay inside a modal dialog for inline login.
 * This allows users to log in without navigating to a separate page.
 *
 * @returns {JSX.Element} The QR code login dialog component
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false)
 *
 * <button onClick={() => setOpen(true)}>Login with QR</button>
 * <QRCodeLoginDialog open={open} onOpenChange={setOpen} />
 * ```
 */
export function QRCodeLoginDialog({
  open,
  onOpenChange,
}: QRCodeLoginDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('login.title', 'Login to Bilibili')}</DialogTitle>
        </DialogHeader>
        <QRCodeDisplay />
      </DialogContent>
    </Dialog>
  )
}

export default QRCodeLoginDialog
