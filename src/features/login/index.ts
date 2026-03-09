/**
 * Login Feature Public API
 *
 * This module provides the public API for the login feature, which handles
 * Bilibili authentication using QR code scanning.
 *
 * @module features/login
 *
 * @example
 * ```typescript
 * import { useLogin, QRCodeDisplay } from '@/features/login'
 *
 * function Login() {
 *   const { qrCodeImage, generateNewQrCode } = useLogin()
 *   return <QRCodeDisplay />
 * }
 * ```
 */

// API
export * from './api/loginApi'

// Hooks
export { useLogin } from './model/useLogin'

// Components
export { QRCodeDisplay } from './ui/QRCodeDisplay'
export { QRCodeLoginDialog } from './ui/QRCodeLoginDialog'

// State
export { default as loginReducer, setSession } from './model/loginSlice'
export type { LoginSliceState } from './model/loginSlice'
