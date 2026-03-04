/**
 * QR Code Login API
 *
 * This module provides the TypeScript API layer for Bilibili QR code authentication.
 * It communicates with the Tauri backend to handle the complete QR login flow,
 * including QR code generation, status polling, and session management.
 *
 * @module loginApi
 */

import { invoke } from '@tauri-apps/api/core'

/**
 * QR code login status states.
 *
 * - `waitingForScan`: QR code generated, waiting for user to scan
 * - `scannedWaitingConfirm`: QR code scanned, waiting for confirmation on mobile
 * - `success`: Login successful, session established
 * - `expired`: QR code expired (180s timeout)
 * - `error`: Unknown error occurred during polling
 *
 * @typedef {('waitingForScan' | 'scannedWaitingConfirm' | 'success' | 'expired' | 'error')} QrCodeStatus
 */
export type QrCodeStatus =
  | 'waitingForScan'
  | 'scannedWaitingConfirm'
  | 'success'
  | 'expired'
  | 'error'

/**
 * Result from QR code generation API.
 *
 * Contains the base64-encoded QR code image and the key used for polling.
 *
 * @interface QrCodeResult
 * @property {string} qrCodeImage - Base64-encoded PNG data URL of the QR code
 * @property {string} qrcodeKey - Unique key for polling login status (valid for 180 seconds)
 */
export interface QrCodeResult {
  qrCodeImage: string
  qrcodeKey: string
}

/**
 * Result from QR code status polling.
 *
 * Contains the current login status and session data if login succeeded.
 *
 * @interface QrPollResult
 * @property {QrCodeStatus} status - Current QR code status
 * @property {string} message - Status message for display (localized by backend)
 * @property {QrSession | null} session - Session data if login succeeded, null otherwise
 */
export interface QrPollResult {
  status: QrCodeStatus
  message: string
  session: QrSession | null
}

/**
 * QR code login session data.
 *
 * Contains authentication cookies and tokens extracted after successful login.
 * This data is persisted for automatic login on subsequent app launches.
 *
 * @interface QrSession
 * @property {string} sessdata - SESSDATA cookie value for authentication
 * @property {string} biliJct - CSRF token (bili_jct) for API requests
 * @property {string} dedeUserId - User ID from DedeUserID cookie
 * @property {string} dedeUserIdCkMd5 - MD5 hash of user ID for validation
 * @property {string} refreshToken - Token for session renewal
 * @property {number} timestamp - Login timestamp in milliseconds
 */
export interface QrSession {
  sessdata: string
  biliJct: string
  dedeUserId: string
  dedeUserIdCkMd5: string
  refreshToken: string
  timestamp: number
}

/**
 * Available login methods.
 *
 * - `firefox`: Import cookies from Firefox browser (legacy method)
 * - `qrCode`: Use QR code authentication flow
 *
 * @typedef {('firefox' | 'qrCode')} LoginMethod
 */
export type LoginMethod = 'firefox' | 'qrCode'

/**
 * Current login state.
 *
 * Stores the preferred login method and active QR session.
 *
 * @interface LoginState
 * @property {LoginMethod} method - Currently selected login method
 * @property {QrSession | null} qrSession - Active QR session data, null if not logged in via QR
 */
export interface LoginState {
  method: LoginMethod
  qrSession: QrSession | null
}

/**
 * Generates a QR code for Bilibili login.
 *
 * Calls the backend to create a new QR code that can be scanned with the Bilibili mobile app.
 * The QR code is valid for 180 seconds.
 *
 * @returns {Promise<QrCodeResult>} Object containing the base64-encoded QR code image and polling key
 * @throws {Error} If QR code generation fails (network error, API error, etc.)
 *
 * @example
 * ```typescript
 * const { qrCodeImage, qrcodeKey } = await generateQrCode()
 * console.log('QR Code Key:', qrcodeKey)
 * ```
 */
export async function generateQrCode(): Promise<QrCodeResult> {
  return invoke<QrCodeResult>('generate_qr_code')
}

/**
 * Polls the QR code login status.
 *
 * Checks the current status of the QR code authentication. Should be called
 * repeatedly (recommended every 2 seconds) until status becomes 'success', 'expired', or 'error'.
 *
 * @param {string} qrcodeKey - The key returned from {@link generateQrCode}
 * @returns {Promise<QrPollResult>} Object containing current status and optional session data
 * @throws {Error} If polling request fails (network error, invalid key, etc.)
 *
 * @example
 * ```typescript
 * const result = await pollQrStatus(qrcodeKey)
 * if (result.status === 'success') {
 *   console.log('Login successful!')
 * } else if (result.status === 'expired') {
 *   console.log('QR code expired, please generate a new one')
 * }
 * ```
 */
export async function pollQrStatus(qrcodeKey: string): Promise<QrPollResult> {
  return invoke<QrPollResult>('poll_qr_status', { qrcodeKey })
}

/**
 * Logs out by clearing the stored QR session.
 *
 * Removes all authentication data from persistent storage and clears the in-memory cookie cache.
 *
 * @returns {Promise<void>} Resolves when logout is complete
 * @throws {Error} If clearing session data fails
 *
 * @example
 * ```typescript
 * await qrLogout()
 * console.log('Logged out successfully')
 * ```
 */
export async function qrLogout(): Promise<void> {
  return invoke('qr_logout')
}

/**
 * Sets the preferred login method.
 *
 * Updates the user's login method preference, which will be used on next login.
 * Does not affect the current active session.
 *
 * @param {LoginMethod} method - The login method to set ('firefox' or 'qrCode')
 * @returns {Promise<void>} Resolves when preference is saved
 * @throws {Error} If saving preference fails
 *
 * @example
 * ```typescript
 * await setLoginMethod('qrCode')
 * ```
 */
export async function setLoginMethod(method: LoginMethod): Promise<void> {
  return invoke('set_login_method', { method })
}

/**
 * Gets the current login method preference.
 *
 * Retrieves the user's preferred login method from persistent storage.
 *
 * @returns {Promise<LoginMethod>} The current login method ('firefox' or 'qrCode')
 * @throws {Error} If reading preference fails
 *
 * @example
 * ```typescript
 * const method = await getLoginMethod()
 * console.log('Current method:', method)
 * ```
 */
export async function getLoginMethod(): Promise<LoginMethod> {
  return invoke<LoginMethod>('get_login_method')
}

/**
 * Gets the current login state.
 *
 * Retrieves the complete login state including the preferred method and active session.
 *
 * @returns {Promise<LoginState>} Object containing current method and session data
 * @throws {Error} If reading state fails
 *
 * @example
 * ```typescript
 * const state = await getLoginState()
 * if (state.qrSession) {
 *   console.log('Logged in via QR code')
 * }
 * ```
 */
export async function getLoginState(): Promise<LoginState> {
  return invoke<LoginState>('get_login_state')
}

/**
 * Loads stored QR session on app startup.
 *
 * Attempts to restore a previously saved QR code session from persistent storage.
 * Should be called on app startup to automatically log in returning users.
 *
 * @returns {Promise<boolean>} True if a QR session was successfully loaded, false otherwise
 * @throws {Error} If reading stored session fails
 *
 * @example
 * ```typescript
 * const hasSession = await loadQrSession()
 * if (hasSession) {
 *   console.log('Restored previous login session')
 * } else {
 *   console.log('No saved session found')
 * }
 * ```
 */
export async function loadQrSession(): Promise<boolean> {
  return invoke<boolean>('load_qr_session')
}

/**
 * Checks if cookie refresh is needed.
 *
 * Calls Bilibili's cookie info API to determine if the current session
 * needs to be refreshed to extend its validity.
 *
 * @returns {Promise<CookieRefreshInfo>} Object containing refresh flag and timestamp
 * @throws {Error} If API request fails
 *
 * @example
 * ```typescript
 * const info = await checkCookieRefresh()
 * if (info.refresh) {
 *   console.log('Cookie refresh needed')
 * }
 * ```
 */
export async function checkCookieRefresh(): Promise<CookieRefreshInfo> {
  return invoke<CookieRefreshInfo>('check_cookie_refresh')
}

/**
 * Refreshes the cookie using the stored refresh_token.
 *
 * This extends the session validity by obtaining new cookies from Bilibili.
 * The new session data is automatically saved and the cookie cache is updated.
 *
 * @returns {Promise<QrSession>} New session data with updated cookies and refresh_token
 * @throws {Error} If refresh fails or no session exists
 *
 * @example
 * ```typescript
 * const newSession = await refreshCookie()
 * console.log('Session refreshed:', newSession.timestamp)
 * ```
 */
export async function refreshCookie(): Promise<QrSession> {
  return invoke<QrSession>('refresh_cookie')
}

/**
 * Cookie refresh info from Bilibili API.
 */
export interface CookieRefreshInfo {
  /** Whether cookie refresh is needed */
  refresh: boolean
  /** Current timestamp in milliseconds */
  timestamp: number
}
