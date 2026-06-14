/**
 * useLogin Hook
 *
 * Custom hook for managing the complete QR code login flow.
 * Handles QR code generation, status polling, session management, and error handling.
 *
 * The polling mechanism:
 * - Uses refs to survive re-renders
 * - Guards against race conditions
 * - Automatically stops on success, expiry, or error
 * - Cleans up timers on unmount
 *
 * @module useLogin
 */

import { useCallback, useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'

import type { RootState } from '@/app/store'
import {
  generateQrCode,
  getLoginState,
  pollQrStatus,
  qrLogout,
  setLoginMethod as setLoginMethodApi,
} from '../api/loginApi'
import {
  clearQrCode,
  resetLogin,
  setError,
  setLoginMethod,
  setQrCode,
  setQrLoading,
  setQrStatus,
  setSession,
} from './loginSlice'

/** Interval between successive QR status polls, in milliseconds. */
const POLL_INTERVAL_MS = 2000

/** Time after which an unscanned QR code is considered expired, in milliseconds. */
const QR_EXPIRY_MS = 180000

/**
 * Extracts a human-readable message from a thrown value, falling back to a
 * default.
 *
 * @param error - The thrown value. Only `Error` instances expose `.message`;
 *   all other values (strings, objects, etc.) trigger the fallback.
 * @param fallback - Message returned when `error` is not an `Error`.
 * @returns The error message or `fallback`.
 */
function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/**
 * Hook that encapsulates the complete QR-code login lifecycle.
 *
 * Manages QR code generation, recursive status polling, session
 * persistence, logout, and login-method switching.  Polling timers
 * are held in refs so they survive re-renders; an expiry timeout
 * automatically stops polling after {@link QR_EXPIRY_MS}.
 *
 * @returns The full login state spread together with action callbacks:
 *   - `generateNewQrCode` - requests a new QR code and starts polling
 *   - `stopPolling` - immediately cancels the active polling loop
 *   - `logout` - clears the server-side session and local state
 *   - `changeLoginMethod` - switches the preferred login method
 *   - `resetLogin` - resets the login slice to its initial state
 *
 * @example
 * ```tsx
 * const { qrCode, qrStatus, generateNewQrCode } = useLogin()
 * ```
 */
export function useLogin() {
  const dispatch = useDispatch()
  const loginState = useSelector((state: RootState) => state.login)
  const pollIntervalRef = useRef<number | null>(null)
  const expiryTimeoutRef = useRef<number | null>(null)
  const isPollingRef = useRef(false)

  /** Clears all polling timers. */
  const clearTimers = useCallback(() => {
    if (pollIntervalRef.current) {
      clearTimeout(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    if (expiryTimeoutRef.current) {
      clearTimeout(expiryTimeoutRef.current)
      expiryTimeoutRef.current = null
    }
  }, [])

  /** Stops the polling mechanism and clears all timers. */
  const stopPolling = useCallback(() => {
    isPollingRef.current = false
    clearTimers()
  }, [clearTimers])

  /**
   * Starts polling for QR code status every {@link POLL_INTERVAL_MS} until a
   * terminal state (`success`, `expired`, or `error`) is reached.
   *
   * Polling is implemented recursively with `setTimeout` instead of
   * `setInterval` so each request completes before the next one is
   * scheduled. This prevents overlapping requests that could race and
   * cause a late poll returning `expired` to overwrite a successful login.
   *
   * Guards:
   * - `isPollingRef` prevents double-starting and short-circuits stale
   *   callbacks that fire after `stopPolling`.
   * - `expiryTimeoutRef` auto-expires the QR code after
   *   {@link QR_EXPIRY_MS} so polling never runs forever even if the API
   *   keeps returning `waiting`.
   *
   * @param qrcodeKey - The polling key returned by `generateQrCode`.
   */
  const startPolling = useCallback(
    (qrcodeKey: string) => {
      if (isPollingRef.current) return

      clearTimers()
      isPollingRef.current = true

      // Set expiry timeout (180 seconds)
      expiryTimeoutRef.current = window.setTimeout(() => {
        if (isPollingRef.current) {
          dispatch(
            setQrStatus({ status: 'expired', message: 'QR code expired' }),
          )
          stopPolling()
        }
      }, QR_EXPIRY_MS)

      // Recursive poll — schedules the next poll only after the previous one
      // completes.  This prevents overlapping requests which can cause a race
      // condition where a late second poll returns "expired" before the first
      // (successful) poll finishes processing.
      const poll = async () => {
        if (!isPollingRef.current) return

        try {
          const result = await pollQrStatus(qrcodeKey)
          if (!isPollingRef.current) return

          dispatch(
            setQrStatus({ status: result.status, message: result.message }),
          )

          if (result.status === 'success') {
            const loginStateResult = await getLoginState()
            // Backend persists method=qrCode on successful QR login; sync the
            // local slice so any open SettingsForm reflects the new method.
            dispatch(setLoginMethod(loginStateResult.method))
            if (loginStateResult.session) {
              dispatch(setSession(loginStateResult.session))
            }
            stopPolling()
          } else if (result.status === 'expired' || result.status === 'error') {
            stopPolling()
          } else {
            // Schedule next poll only after this one completes
            pollIntervalRef.current = window.setTimeout(poll, POLL_INTERVAL_MS)
          }
        } catch (error) {
          if (isPollingRef.current) {
            dispatch(setError(errorMessage(error, 'Polling failed')))
            stopPolling()
          }
        }
      }

      // Start first poll immediately
      poll()
    },
    [dispatch, clearTimers, stopPolling],
  )

  /** Generates a new QR code and starts polling. Idempotent. */
  const generateNewQrCode = useCallback(async () => {
    stopPolling()
    dispatch(setQrLoading(true))
    dispatch(clearQrCode())

    try {
      const result = await generateQrCode()
      dispatch(setQrCode({ image: result.qrCodeImage, key: result.qrcodeKey }))
      startPolling(result.qrcodeKey)
    } catch (error) {
      dispatch(setError(errorMessage(error, 'Failed to generate QR code')))
    } finally {
      dispatch(setQrLoading(false))
    }
  }, [dispatch, stopPolling, startPolling])

  /** Logs out the current user. */
  const logout = useCallback(async () => {
    try {
      await qrLogout()
      dispatch(setSession(null))
    } catch (error) {
      dispatch(setError(errorMessage(error, 'Logout failed')))
    }
  }, [dispatch])

  /** Changes the preferred login method. */
  const changeLoginMethod = useCallback(
    async (method: 'firefox' | 'qrCode') => {
      try {
        await setLoginMethodApi(method)
        dispatch(setLoginMethod(method))
      } catch (error) {
        dispatch(setError(errorMessage(error, 'Failed to change login method')))
      }
    },
    [dispatch],
  )

  /**
   * Stops any active polling loop and clears timers when the component
   * unmounts. The ref guard (`isPollingRef`) is flipped first so any
   * in-flight fetch that resolves after unmount is ignored.
   */
  useEffect(() => {
    return () => {
      isPollingRef.current = false
      clearTimers()
    }
  }, [clearTimers])

  return {
    ...loginState,
    generateNewQrCode,
    stopPolling,
    logout,
    changeLoginMethod,
    resetLogin: () => dispatch(resetLogin()),
  }
}
