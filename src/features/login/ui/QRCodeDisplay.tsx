/**
 * QRCodeDisplay Component
 *
 * Displays the QR code for Bilibili login with real-time status updates.
 * This component handles the complete QR code login UI including:
 *
 * - QR code generation and display
 * - Status indicators (waiting, scanned, success, expired, error)
 * - Automatic navigation after successful login
 * - Refresh functionality for expired/error states
 * - Loading states during generation
 *
 * The component uses the {@link useLogin} hook for state management and
 * automatically generates a QR code on mount.
 *
 * @module QRCodeDisplay
 *
 * @example
 * ```tsx
 * import { QRCodeDisplay } from '@/features/login'
 *
 * function LoginPage() {
 *   return <QRCodeDisplay />
 * }
 * ```
 */

import { useUser } from '@/features/user'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import {
  CheckCircle,
  Loader2,
  RefreshCw,
  Smartphone,
  XCircle,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useLogin } from '../model/useLogin'

/**
 * QRCodeDisplay component props.
 *
 * Currently this component has no props as it manages all its state
 * internally via the useLogin hook.
 */
export interface QRCodeDisplayProps {}

/**
 * Status configuration for display.
 *
 * @interface StatusConfig
 * @property {React.ReactNode} icon - Icon component to display
 * @property {string} text - Status message text
 * @property {string} colorClass - Tailwind CSS class for text color
 */
interface StatusConfig {
  icon: React.ReactNode
  text: string
  colorClass: string
}

/**
 * Displays the QR code for Bilibili login with status updates.
 *
 * This component:
 * 1. Automatically generates a QR code on mount
 * 2. Shows loading state while generating
 * 3. Displays the QR code with status icon and message
 * 4. Handles expired/error states with refresh button
 * 5. Automatically navigates to home after successful login
 * 6. Cleans up polling and timers on unmount
 *
 * @returns {JSX.Element} The QR code display component
 *
 * @example
 * ```tsx
 * <QRCodeDisplay />
 * ```
 */
export function QRCodeDisplay() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { getUserInfo } = useUser()
  const {
    qrCodeImage,
    qrStatus,
    statusMessage,
    isQrLoading,
    error,
    generateNewQrCode,
    stopPolling,
  } = useLogin()

  // Track if we've handled the success state to prevent duplicate navigation
  const [hasHandledSuccess, setHasHandledSuccess] = useState(false)
  // Use ref for navigation timer to survive re-renders and prevent memory leaks
  const navigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Generate QR code on mount (only once).
   *
   * This effect runs when the component first mounts and there is no
   * existing QR code. It ensures a QR code is available immediately
   * for the user to scan.
   */
  useEffect(() => {
    if (!qrCodeImage && !isQrLoading) {
      generateNewQrCode()
    }
  }, [])

  /**
   * Cleanup effect - stop polling and clear navigation timer on unmount.
   *
   * Ensures all resources are properly cleaned up when the component
   * is destroyed to prevent memory leaks and unnecessary API calls.
   */
  useEffect(() => {
    return () => {
      stopPolling()
      if (navigationTimerRef.current) {
        clearTimeout(navigationTimerRef.current)
      }
    }
  }, [])

  /**
   * Handle login success - navigate to home after short delay.
   *
   * This effect:
   * 1. Detects when login status changes to 'success'
   * 2. Prevents duplicate handling with hasHandledSuccess flag
   * 3. Stops polling immediately
   * 4. Refreshes user info to update app bar
   * 5. Navigates to home after 1.5 second delay to show success message
   *
   * The delay allows the user to see the success animation before
   * being redirected to the home page.
   */
  useEffect(() => {
    // Only run once when qrStatus becomes 'success'
    if (qrStatus === 'success' && !hasHandledSuccess) {
      setHasHandledSuccess(true)

      // Stop polling immediately to prevent unnecessary API calls
      stopPolling()

      // Refresh user info to update AppBar with logged-in state
      getUserInfo().catch(console.error)

      // Navigate after a short delay to show success message
      navigationTimerRef.current = setTimeout(() => {
        navigate('/home')
      }, 1500)
    }
  }, [qrStatus, hasHandledSuccess]) // Minimal deps - navigate and getUserInfo are stable

  /**
   * Gets the status configuration based on current QR code status.
   *
   * Returns the appropriate icon, text, and color class for display
   * based on the current authentication status.
   *
   * @returns {StatusConfig} Object containing icon, text, and color class
   */
  const getStatusConfig = (): StatusConfig => {
    switch (qrStatus) {
      case 'success':
        return {
          icon: <CheckCircle className="h-5 w-5 text-green-500" />,
          text: t('login.loginSuccess', 'Login successful!'),
          colorClass: 'text-green-500',
        }
      case 'expired':
        return {
          icon: <XCircle className="h-5 w-5 text-red-500" />,
          text: t('login.qrExpired', 'QR code expired'),
          colorClass: 'text-red-500',
        }
      case 'error':
        return {
          icon: <XCircle className="h-5 w-5 text-red-500" />,
          text: statusMessage || t('login.loginFailed', 'Login failed'),
          colorClass: 'text-red-500',
        }
      case 'scannedWaitingConfirm':
        return {
          icon: <Smartphone className="h-5 w-5 text-blue-500" />,
          text: t('login.confirmOnPhone', 'Confirm on your phone'),
          colorClass: 'text-blue-500',
        }
      case 'waitingForScan':
        return {
          icon: null,
          text: t('login.scanWithApp', 'Scan with Bilibili App'),
          colorClass: 'text-muted-foreground',
        }
      default:
        return { icon: null, text: '', colorClass: 'text-muted-foreground' }
    }
  }

  const statusConfig = getStatusConfig()

  /**
   * Initial loading state.
   *
   * Shows a spinner while the QR code is being generated.
   * Only displays on first load when there's no existing QR code.
   */
  if (isQrLoading && !qrCodeImage) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <Loader2 className="text-primary h-12 w-12 animate-spin" />
        <p className="text-muted-foreground mt-4 text-sm">
          {t('login.generatingQR', 'Generating QR code...')}
        </p>
      </div>
    )
  }

  /**
   * Main QR code display.
   *
   * Shows:
   * - The QR code image (or loading placeholder)
   * - Expired overlay with refresh button (when expired)
   * - Status icon and message
   * - Error message (if any)
   * - Instructions (when waiting for scan)
   * - Refresh button (when expired/error)
   */
  return (
    <div className="flex flex-col items-center space-y-4">
      {/* QR Code Image */}
      <div className="relative">
        {qrCodeImage ? (
          <img
            src={qrCodeImage}
            alt="Bilibili Login QR Code"
            className={cn(
              'h-48 w-48 rounded-lg border',
              qrStatus === 'expired' && 'opacity-50',
            )}
          />
        ) : (
          <div className="bg-muted flex h-48 w-48 items-center justify-center rounded-lg border">
            <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
          </div>
        )}

        {/* Expired overlay - shown when QR code has expired */}
        {qrStatus === 'expired' && (
          <div className="bg-background/80 absolute inset-0 flex items-center justify-center rounded-lg">
            <Button
              variant="outline"
              size="sm"
              onClick={generateNewQrCode}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              {t('login.refresh', 'Refresh')}
            </Button>
          </div>
        )}
      </div>

      {/* Status indicator with icon and message */}
      <div className={cn('flex items-center gap-2', statusConfig.colorClass)}>
        {statusConfig.icon}
        <span className="text-sm font-medium">{statusConfig.text}</span>
      </div>

      {/* Error message - shown when polling fails */}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Instructions - shown when waiting for user to scan */}
      {qrStatus === 'waitingForScan' && (
        <p className="text-muted-foreground text-center text-xs">
          {t(
            'login.instructions',
            'Open Bilibili App on your phone and scan this QR code to log in',
          )}
        </p>
      )}

      {/* Refresh button - shown for expired/error states */}
      {(qrStatus === 'expired' || qrStatus === 'error') && (
        <Button variant="outline" onClick={generateNewQrCode} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          {t('login.tryAgain', 'Try Again')}
        </Button>
      )}
    </div>
  )
}

export default QRCodeDisplay
