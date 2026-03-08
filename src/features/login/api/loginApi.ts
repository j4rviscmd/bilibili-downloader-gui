/**
 * QR Code Login API
 *
 * TypeScript API layer for Bilibili QR code authentication.
 * Communicates with Tauri backend for QR code generation, status polling, and session management.
 *
 * @module loginApi
 */

import { invoke } from '@tauri-apps/api/core'
import { logger } from '@/shared/lib/logger'

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
  /** Username (display name) */
  uname: string
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
  logger.info('generateQrCode: Generating QR code')
  try {
    const result = await invoke<QrCodeResult>('generate_qr_code')
    logger.info('generateQrCode: QR code generated successfully')
    return result
  } catch (error) {
    logger.error('generateQrCode: Failed to generate QR code', error)
    throw error
  }
}

/**
 * Polls the QR code login status.
 * Should be called repeatedly (every 2 seconds) until terminal status.
 */
export async function pollQrStatus(qrcodeKey: string): Promise<QrPollResult> {
  try {
    const result = await invoke<QrPollResult>('poll_qr_status', { qrcodeKey })
    logger.debug(`pollQrStatus: status=${result.status}`)
    return result
  } catch (error) {
    logger.error('pollQrStatus: Failed to poll QR status', error)
    throw error
  }
}

/** Logs out by clearing the stored QR session. */
export async function qrLogout(): Promise<void> {
  logger.info('qrLogout: Logging out')
  try {
    await invoke('qr_logout')
    logger.info('qrLogout: Logged out successfully')
  } catch (error) {
    logger.error('qrLogout: Failed to logout', error)
    throw error
  }
}

/** Sets the preferred login method. */
export async function setLoginMethod(method: LoginMethod): Promise<void> {
  logger.info(`setLoginMethod: method=${method}`)
  try {
    await invoke('set_login_method', { method })
  } catch (error) {
    logger.error('setLoginMethod: Failed to set login method', error)
    throw error
  }
}

/** Gets the current login method preference. */
export async function getLoginMethod(): Promise<LoginMethod> {
  try {
    const result = await invoke<LoginMethod>('get_login_method')
    logger.debug(`getLoginMethod: method=${result}`)
    return result
  } catch (error) {
    logger.error('getLoginMethod: Failed to get login method', error)
    throw error
  }
}

/** Gets the current login state including method and session. */
export async function getLoginState(): Promise<LoginState> {
  try {
    const result = await invoke<LoginState>('get_login_state')
    logger.debug(`getLoginState: method=${result.method}, hasSession=${!!result.session}`)
    return result
  } catch (error) {
    logger.error('getLoginState: Failed to get login state', error)
    throw error
  }
}

/** Loads stored QR session on app startup. Returns true if session was restored. */
export async function loadQrSession(): Promise<boolean> {
  logger.info('loadQrSession: Loading stored QR session')
  try {
    const result = await invoke<boolean>('load_qr_session')
    logger.info(`loadQrSession: Session ${result ? 'found' : 'not found'}`)
    return result
  } catch (error) {
    logger.error('loadQrSession: Failed to load QR session', error)
    throw error
  }
}

/** Checks if cookie refresh is needed. */
export async function checkCookieRefresh(): Promise<CookieRefreshInfo> {
  try {
    const result = await invoke<CookieRefreshInfo>('check_cookie_refresh')
    logger.debug(`checkCookieRefresh: refresh=${result.refresh}`)
    return result
  } catch (error) {
    logger.error('checkCookieRefresh: Failed to check cookie refresh', error)
    throw error
  }
}

/** Refreshes the cookie using the stored refresh_token. */
export async function refreshCookie(): Promise<QrSession> {
  logger.info('refreshCookie: Refreshing cookie')
  try {
    const result = await invoke<QrSession>('refresh_cookie')
    logger.info('refreshCookie: Cookie refreshed successfully')
    return result
  } catch (error) {
    logger.error('refreshCookie: Failed to refresh cookie', error)
    throw error
  }
}

/** Cookie refresh info from Bilibili API. */
export interface CookieRefreshInfo {
  /** Whether cookie refresh is needed */
  refresh: boolean
  /** Current timestamp in milliseconds */
  timestamp: number
}
