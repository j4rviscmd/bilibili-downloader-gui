/**
 * QRCodeLoginDialog Component
 *
 * A dialog component for logging in to Bilibili. Offers three tabs in
 * the settings account-section order: Firefox cookie switch, QR code
 * scan, and manual cookie paste. The Firefox tab persists the method
 * switch and relaunches (see FirefoxCookiePanel); the QR tab polls
 * until the scan is confirmed; the manual tab verifies a pasted Cookie
 * header via the nav API before storing it.
 *
 * @module QRCodeLoginDialog
 */

import { store, useSelector } from '@/app/store'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/animate-ui/radix/dialog'
import { ClipboardPaste, Globe, QrCode } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { setLoginMethod as setLoginMethodAction } from '../model/loginSlice'
import { FirefoxCookiePanel } from './FirefoxCookiePanel'
import { FirefoxPermissionNotice } from './FirefoxPermissionNotice'
import { ManualCookieForm } from './ManualCookieForm'
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
 * Dialog component for QR code / manual cookie login.
 *
 * Mounts QRCodeDisplay only while the QR tab is active and the dialog is
 * open, so polling stops on tab switch or close and a fresh QR is generated
 * on each activation (remount triggers QRCodeDisplay's mount effect).
 *
 * @returns {JSX.Element} The login dialog component
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useState(false)
 *
 * <button onClick={() => setOpen(true)}>Login</button>
 * <QRCodeLoginDialog open={open} onOpenChange={setOpen} />
 * ```
 */
export function QRCodeLoginDialog({
  open,
  onOpenChange,
}: QRCodeLoginDialogProps) {
  const { t } = useTranslation()
  const loginMethod = useSelector((state) => state.login.loginMethod)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('login.title', 'Login to Bilibili')}</DialogTitle>
        </DialogHeader>
        <FirefoxPermissionNotice onResolved={() => onOpenChange(false)} />
        {/* shortcut: the default is re-read only because DialogContent
            unmounts the tabs on close; upgrade to a controlled tab if
            the shell starts staying mounted */}
        <Tabs defaultValue={loginMethod === 'qrCode' ? 'qr' : loginMethod}>
          <TabsList className="w-full">
            {/* Tab order mirrors the settings account section (firefox /
                qrCode / manual) so the two surfaces read the same way. */}
            <TabsTrigger
              value="firefox"
              className="flex-1 gap-1"
              data-testid="login-tab-firefox"
            >
              <Globe className="size-4" aria-hidden="true" />
              {t('login.firefoxCookieTab')}
            </TabsTrigger>
            <TabsTrigger
              value="qr"
              className="flex-1 gap-1"
              data-testid="login-tab-qr"
            >
              <QrCode className="size-4" aria-hidden="true" />
              {t('login.qrCodeTab')}
            </TabsTrigger>
            <TabsTrigger
              value="manual"
              className="flex-1 gap-1"
              data-testid="login-tab-manual"
            >
              <ClipboardPaste className="size-4" aria-hidden="true" />
              {t('login.manualCookieTab')}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="firefox">
            {open && <FirefoxCookiePanel />}
          </TabsContent>
          <TabsContent value="qr">
            {open && <QRCodeDisplay onSuccess={() => onOpenChange(false)} />}
          </TabsContent>
          <TabsContent value="manual">
            {open && (
              <ManualCookieForm
                onApplied={() => {
                  // Why: commit_session already persisted method=manual
                  // backend-side (src-tauri/src/handlers/manual_login.rs)
                  // and Redux only re-syncs at boot (useInit) — mirror it
                  // here so the next dialog open lands on the manual tab
                  store.dispatch(setLoginMethodAction('manual'))
                  onOpenChange(false)
                }}
              />
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

export default QRCodeLoginDialog
