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

// Pure login-status helpers (shared with the settings page)
export * from './loginStatus'

// Hooks
export { useLogin } from './model/useLogin'

// Components
export { ManualCookieForm } from './ui/ManualCookieForm'
export { QRCodeDisplay } from './ui/QRCodeDisplay'
export { QRCodeLoginDialog } from './ui/QRCodeLoginDialog'

// State
// setLoginMethod is aliased: the api module already exports an async
// `setLoginMethod` (backend call); the slice action needs a distinct name.
export {
  default as loginReducer,
  setLoginMethod as setLoginMethodAction,
  setSession,
} from './model/loginSlice'
export type { LoginSliceState } from './model/loginSlice'
