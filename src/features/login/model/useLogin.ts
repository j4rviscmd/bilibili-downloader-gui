/**
 * useLogin Hook
 *
 * Custom hook for managing the complete QR code login flow.
 *
 * This hook encapsulates all logic for:
 * - QR code generation
 * - Polling for login status
 * - Session management
 * - Error handling
 * - Login/logout operations
 *
 * The polling mechanism is designed to be robust:
 * - Uses refs to survive re-renders
 * - Guards against race conditions
 * - Automatically stops on success, expiry, or error
 * - Cleans up timers on unmount
 *
 * @module useLogin
 *
 * @example
 * ```typescript
 * function Login() {
 *   const {
 *     qrCodeImage,
 *     qrStatus,
 *     statusMessage,
 *     isQrLoading,
 *     error,
 *     generateNewQrCode,
 *     stopPolling,
 *   } = useLogin()
 *
 *   return (
 *     <div>
 *       {isQrLoading ? <Spinner /> : <img src={qrCodeImage} />}
 *       <p>{statusMessage}</p>
 *       <button onClick={generateNewQrCode}>Refresh</button>
 *     </div>
 *   )
 * }
 * ```
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
  setError,
  setLoginMethod,
  setQrCode,
  setQrLoading,
  setQrSession,
  setQrStatus,
} from './loginSlice'

/** Polling interval for checking QR code status (2 seconds) */
const POLL_INTERVAL_MS = 2000
/** QR code validity duration (180 seconds = 3 minutes) */
const QR_EXPIRY_MS = 180000

/**
 * Custom hook for managing QR code login flow.
 *
 * @returns {UseLoginReturn} Object containing login state and control functions
 *
 * @example
 * ```typescript
 * const {
 *   qrCodeImage,      // Base64 QR code image
 *   qrStatus,         // Current login status
 *   statusMessage,    // Status message for display
 *   isQrLoading,      // Loading state
 *   error,            // Error message if any
 *   generateNewQrCode, // Function to generate new QR code
 *   stopPolling,      // Function to stop polling
 *   logout,           // Function to logout
 *   changeLoginMethod,// Function to change login method
 * } = useLogin()
 * ```
 */
export function useLogin() {
  const dispatch = useDispatch()
  const loginState = useSelector((state: RootState) => state.login)
  const pollIntervalRef = useRef<number | null>(null)
  const expiryTimeoutRef = useRef<number | null>(null)
  const isPollingRef = useRef(false)

  /**
   * Clears all polling timers.
   *
   * Stops both the polling interval and the expiry timeout.
   * Uses refs to ensure timers are properly cleaned up.
   */
  const clearTimers = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    if (expiryTimeoutRef.current) {
      clearTimeout(expiryTimeoutRef.current)
      expiryTimeoutRef.current = null
    }
  }, [])

  /**
   * Stops the polling mechanism.
   *
   * Sets the polling flag to false and clears all timers.
   * This is a stable function (no dependencies) that can be safely
   * passed to child components or used in useEffect.
   *
   * @example
   * ```typescript
   * useEffect(() => {
   *   return () => {
   *     stopPolling() // Cleanup on unmount
   *   }
   * }, [])
   * ```
   */
  const stopPolling = useCallback(() => {
    isPollingRef.current = false
    clearTimers()
  }, [clearTimers])

  /**
   * Starts polling for QR code status.
   *
   * Initiates periodic polling of the Bilibili API to check if the user
   * has scanned the QR code and confirmed login. The polling will:
   * - Continue every 2 seconds
   * - Automatically stop after 180 seconds (QR expiry)
   * - Stop immediately on success, expiry, or error
   *
   * @param {string} qrcodeKey - The QR code key returned from generateQrCode
   *
   * @example
   * ```typescript
   * const result = await generateQrCode()
   * startPolling(result.qrcodeKey)
   * ```
   */
  const startPolling = useCallback(
    (qrcodeKey: string) => {
      // Don't start if already polling
      if (isPollingRef.current) {
        return
      }

      // Clear any existing timers and set polling flag
      clearTimers()
      isPollingRef.current = true

      // Set expiry timeout - QR codes expire after 180 seconds
      expiryTimeoutRef.current = window.setTimeout(() => {
        if (isPollingRef.current) {
          dispatch(
            setQrStatus({ status: 'expired', message: 'QR code expired' }),
          )
          stopPolling()
        }
      }, QR_EXPIRY_MS)

      // Start polling interval
      pollIntervalRef.current = window.setInterval(async () => {
        // Guard: Check if we should continue polling
        if (!isPollingRef.current) {
          return
        }

        try {
          const result = await pollQrStatus(qrcodeKey)

          // Guard: Check again after async operation
          // (polling may have been stopped while waiting)
          if (!isPollingRef.current) {
            return
          }

          // Update status in Redux store
          dispatch(
            setQrStatus({ status: result.status, message: result.message }),
          )

          // Handle terminal states
          if (result.status === 'success') {
            // Session is stored internally by backend, fetch and update state
            const loginStateResult = await getLoginState()
            if (loginStateResult.qrSession) {
              dispatch(setQrSession(loginStateResult.qrSession))
            }
            stopPolling()
          } else if (result.status === 'expired' || result.status === 'error') {
            stopPolling()
          }
        } catch (error) {
          // Handle polling errors
          if (isPollingRef.current) {
            dispatch(
              setError(
                error instanceof Error ? error.message : 'Polling failed',
              ),
            )
            stopPolling()
          }
        }
      }, POLL_INTERVAL_MS)
    },
    [dispatch, clearTimers, stopPolling],
  )

  /**
   * Generates a new QR code for login.
   *
   * Stops any existing polling, clears the current QR code state,
   * generates a new QR code from the backend, and starts polling.
   *
   * This function is idempotent - calling it multiple times will safely
   * cancel previous operations before starting new ones.
   *
   * @throws {Error} If QR code generation fails
   *
   * @example
   * ```typescript
   * <Button onClick={generateNewQrCode}>
   *   Generate QR Code
   * </Button>
   * ```
   */
  const generateNewQrCode = useCallback(async () => {
    // Stop any existing polling first to prevent race conditions
    stopPolling()

    // Set loading state and clear previous QR code
    dispatch(setQrLoading(true))
    dispatch(clearQrCode())

    try {
      const result = await generateQrCode()
      // Update state with new QR code
      dispatch(setQrCode({ image: result.qrCodeImage, key: result.qrcodeKey }))
      // Start polling for login status
      startPolling(result.qrcodeKey)
    } catch (error) {
      dispatch(
        setError(
          error instanceof Error ? error.message : 'Failed to generate QR code',
        ),
      )
    } finally {
      dispatch(setQrLoading(false))
    }
  }, [dispatch, stopPolling, startPolling])

  /**
   * Logs out the current user.
   *
   * Clears the stored session from the backend and updates the local state.
   *
   * @throws {Error} If logout operation fails
   *
   * @example
   * ```typescript
   * <Button onClick={logout}>
   *   Logout
   * </Button>
   * ```
   */
  const logout = useCallback(async () => {
    try {
      await qrLogout()
      dispatch(setQrSession(null))
    } catch (error) {
      dispatch(
        setError(error instanceof Error ? error.message : 'Logout failed'),
      )
    }
  }, [dispatch])

  /**
   * Changes the preferred login method.
   *
   * Updates the user's login method preference and persists it.
   * This does not affect the current active session.
   *
   * @param {'firefox' | 'qrCode'} method - The login method to set
   * @throws {Error} If updating the preference fails
   *
   * @example
   * ```typescript
   * await changeLoginMethod('qrCode')
   * ```
   */
  const changeLoginMethod = useCallback(
    async (method: 'firefox' | 'qrCode') => {
      try {
        await setLoginMethodApi(method)
        dispatch(setLoginMethod(method))
      } catch (error) {
        dispatch(
          setError(
            error instanceof Error
              ? error.message
              : 'Failed to change login method',
          ),
        )
      }
    },
    [dispatch],
  )

  /**
   * Cleanup effect - stops polling when component unmounts.
   *
   * Ensures all timers are cleared to prevent memory leaks and
   * unnecessary API calls after the component is destroyed.
   */
  useEffect(() => {
    return () => {
      isPollingRef.current = false
      clearTimers()
    }
  }, [clearTimers])

  /**
   * Return value interface for useLogin hook.
   *
   * @typedef {Object} UseLoginReturn
   * @property {string | null} qrCodeImage - Base64-encoded QR code image
   * @property {QrCodeStatus | null} qrStatus - Current login status
   * @property {string} statusMessage - Human-readable status message
   * @property {boolean} isQrLoading - Whether QR code is being generated
   * @property {string | null} error - Error message if any
   * @property {string | null} qrcodeKey - QR code polling key
   * @property {LoginMethod} loginMethod - Current login method preference
   * @property {QrSession | null} qrSession - Active session data
   * @property {() => Promise<void>} generateNewQrCode - Generate new QR code
   * @property {() => void} stopPolling - Stop polling for status
   * @property {() => Promise<void>} logout - Logout current user
   * @property {(method: 'firefox' | 'qrCode') => Promise<void>} changeLoginMethod - Change login method
   */
  return {
    ...loginState,
    generateNewQrCode,
    stopPolling,
    logout,
    changeLoginMethod,
  }
}
