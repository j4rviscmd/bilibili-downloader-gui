/**
 * RestartConfirmDialog Component
 *
 * Shared restart-confirmation dialog for login-method switches. The switch
 * is persisted and the app relaunched only by the caller's confirm handler;
 * cancel (overlay click) leaves persistence to the caller — typically
 * nothing is persisted yet at that point.
 *
 * @module RestartConfirmDialog
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/shared/ui/button'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * RestartConfirmDialog component props.
 */
export type RestartConfirmDialogProps = {
  /** Whether the dialog is open */
  open: boolean
  /** Called when the dialog is dismissed without confirming */
  onCancel: () => void
  /** Called when the user confirms — persists the switch and relaunches */
  onConfirm: () => void
  /** Shows the retry hint when a previous restart attempt failed */
  failed?: boolean
}

/**
 * Renders the restart-confirmation dialog.
 *
 * ESC stays disabled (onEscapeKeyDown) and the X stays hidden
 * (showCloseButton) so the only paths are cancel (overlay click) and
 * restart.
 */
export function RestartConfirmDialog({
  open,
  onCancel,
  onConfirm,
  failed = false,
}: RestartConfirmDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('login.restartRequiredTitle')}</DialogTitle>
          <DialogDescription>{t('login.restartRequired')}</DialogDescription>
        </DialogHeader>
        {failed && (
          <p role="alert" className="text-destructive text-sm">
            {t('login.restartFailed')}
          </p>
        )}
        <DialogFooter>
          <Button onClick={onConfirm}>
            <RefreshCw className="mr-2 size-4" />
            {t('login.restartNow')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
