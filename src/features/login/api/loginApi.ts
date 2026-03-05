/**
 * QR Code Login API
 *
 * TypeScript API layer for Bilibili QR code authentication.
 * Communicates with Tauri backend for QR code generation, status polling, and session management.
 *
 * @module loginApi
 */

import { invoke } from '@tauri-apps/api/core'

/** QR code login status states. */
export type QrCodeStatus =
  | 'waitingForScan'
  | 'scannedWaitingConfirm'
  | 'success'
  | 'expired'
  | 'error'

/** Result from QR code generation API. */
export interface QrCodeResult {
  /** Base64-encoded PNG data URL of the QR code */
  qrCodeImage: string
  /** Unique key for polling login status (valid for 180 seconds) */
  qrcodeKey: string
}

/** Result from QR code status polling. */
export interface QrPollResult {
  /** Current QR code status */
  status: QrCodeStatus
  /** Status message for display (localized by backend) */
  message: string
  /** Session data if login succeeded, null otherwise */
  session: QrSession | null
}

/**
 * Session data for authenticated login.
 * Persisted in OS keyring for secure storage.
 */
export interface Session {
  /** SESSDATA cookie value for authentication */
  sessdata: string
  /** CSRF token (bili_jct) for API requests */
  biliJct: string
  /** User ID from DedeUserID cookie */
  dedeUserId: string
  /** MD5 hash of user ID for validation */
  dedeUserIdCkMd5: string
  /** Token for session renewal */
  refreshToken: string
  /** Login timestamp in milliseconds */
  timestamp: number
}

/** @deprecated Use `Session` instead. */
export type QrSession = Session

/** Available login methods. */
export type LoginMethod = 'firefox' | 'qrCode'

/** Current login state. */
export interface LoginState {
  /** Currently selected login method */
  method: LoginMethod
  /** Active session data, null if not logged in */
  session: Session | null
}

/** Generates a QR code for Bilibili login. Valid for 180 seconds. */
export async function generateQrCode(): Promise<QrCodeResult> {
  return invoke<QrCodeResult>('generate_qr_code')
}

/**
 * Polls the QR code login status.
 * Should be called repeatedly (every 2 seconds) until terminal status.
 */
export async function pollQrStatus(qrcodeKey: string): Promise<QrPollResult> {
  return invoke<QrPollResult>('poll_qr_status', { qrcodeKey })
}

/** Logs out by clearing the stored QR session. */
export async function qrLogout(): Promise<void> {
  return invoke('qr_logout')
}

/** Sets the preferred login method. */
export async function setLoginMethod(method: LoginMethod): Promise<void> {
  return invoke('set_login_method', { method })
}

/** Gets the current login method preference. */
export async function getLoginMethod(): Promise<LoginMethod> {
  return invoke<LoginMethod>('get_login_method')
}

/** Gets the current login state including method and session. */
export async function getLoginState(): Promise<LoginState> {
  return invoke<LoginState>('get_login_state')
}

/** Loads stored QR session on app startup. Returns true if session was restored. */
export async function loadQrSession(): Promise<boolean> {
  return invoke<boolean>('load_qr_session')
}

/** Checks if cookie refresh is needed. */
export async function checkCookieRefresh(): Promise<CookieRefreshInfo> {
  return invoke<CookieRefreshInfo>('check_cookie_refresh')
}

/** Refreshes the cookie using the stored refresh_token. */
export async function refreshCookie(): Promise<QrSession> {
  return invoke<QrSession>('refresh_cookie')
}

/** Cookie refresh info from Bilibili API. */
export interface CookieRefreshInfo {
  /** Whether cookie refresh is needed */
  refresh: boolean
  /** Current timestamp in milliseconds */
  timestamp: number
}
