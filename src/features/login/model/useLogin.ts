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
  setError,
  setLoginMethod,
  setQrCode,
  setQrLoading,
  setQrStatus,
  setSession,
} from './loginSlice'

const POLL_INTERVAL_MS = 2000
const QR_EXPIRY_MS = 180000

export function useLogin() {
  const dispatch = useDispatch()
  const loginState = useSelector((state: RootState) => state.login)
  const pollIntervalRef = useRef<number | null>(null)
  const expiryTimeoutRef = useRef<number | null>(null)
  const isPollingRef = useRef(false)

  /** Clears all polling timers. */
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

  /** Stops the polling mechanism and clears all timers. */
  const stopPolling = useCallback(() => {
    isPollingRef.current = false
    clearTimers()
  }, [clearTimers])

  /** Starts polling for QR code status every 2 seconds until terminal state. */
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

      // Start polling interval
      pollIntervalRef.current = window.setInterval(async () => {
        if (!isPollingRef.current) return

        try {
          const result = await pollQrStatus(qrcodeKey)
          if (!isPollingRef.current) return

          dispatch(
            setQrStatus({ status: result.status, message: result.message }),
          )

          if (result.status === 'success') {
            const loginStateResult = await getLoginState()
            if (loginStateResult.session) {
              dispatch(setSession(loginStateResult.session))
            }
            stopPolling()
          } else if (result.status === 'expired' || result.status === 'error') {
            stopPolling()
          }
        } catch (error) {
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
      dispatch(
        setError(
          error instanceof Error ? error.message : 'Failed to generate QR code',
        ),
      )
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
      dispatch(
        setError(error instanceof Error ? error.message : 'Logout failed'),
      )
    }
  }, [dispatch])

  /** Changes the preferred login method. */
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

  // Cleanup on unmount
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
  }
}
