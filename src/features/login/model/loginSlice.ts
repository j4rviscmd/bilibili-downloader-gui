/**
 * Login Redux Slice
 *
 * Manages state for QR code-based Bilibili authentication including
 * QR code generation, status polling, session management, and error handling.
 *
 * @module loginSlice
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { LoginMethod, QrCodeStatus, Session } from '../api/loginApi'

/** State shape for the login slice. */
export interface LoginSliceState {
  /** Current QR code status */
  qrStatus: QrCodeStatus | null
  /** QR code image data URL */
  qrCodeImage: string | null
  /** QR code key for polling */
  qrcodeKey: string | null
  /** Status message from last poll */
  statusMessage: string
  /** Preferred login method */
  loginMethod: LoginMethod
  /** Current session (if logged in) */
  session: Session | null
  /** Whether QR login is in progress */
  isQrLoading: boolean
  /** Error message if any */
  error: string | null
}

const initialState: LoginSliceState = {
  qrStatus: null,
  qrCodeImage: null,
  qrcodeKey: null,
  statusMessage: '',
  loginMethod: 'firefox',
  session: null,
  isQrLoading: false,
  error: null,
}

const loginSlice = createSlice({
  name: 'login',
  initialState,
  reducers: {
    /** Sets QR code image and key. Resets status to 'waitingForScan'. */
    setQrCode(state, action: PayloadAction<{ image: string; key: string }>) {
      state.qrCodeImage = action.payload.image
      state.qrcodeKey = action.payload.key
      state.qrStatus = 'waitingForScan'
      state.statusMessage = ''
      state.error = null
    },
    /** Updates QR code login status. */
    setQrStatus(
      state,
      action: PayloadAction<{ status: QrCodeStatus; message: string }>,
    ) {
      state.qrStatus = action.payload.status
      state.statusMessage = action.payload.message
    },
    /** Sets preferred login method. */
    setLoginMethod(state, action: PayloadAction<LoginMethod>) {
      state.loginMethod = action.payload
    },
    /** Sets session data. qrStatus is managed separately via setQrStatus. */
    setSession(state, action: PayloadAction<Session | null>) {
      state.session = action.payload
    },
    /** Sets QR code loading state. */
    setQrLoading(state, action: PayloadAction<boolean>) {
      state.isQrLoading = action.payload
    },
    /** Sets error message and resets loading state. */
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload
      state.isQrLoading = false
    },
    /** Clears QR code and related state. Does not affect loginMethod. */
    clearQrCode(state) {
      state.qrCodeImage = null
      state.qrcodeKey = null
      state.qrStatus = null
      state.statusMessage = ''
      state.isQrLoading = false
      state.session = null
    },
    /** Resets entire login state to initial values. */
    resetLogin(state) {
      Object.assign(state, initialState)
    },
  },
})

export const {
  setQrCode,
  setQrStatus,
  setLoginMethod,
  setSession,
  setQrLoading,
  setError,
  clearQrCode,
  resetLogin,
} = loginSlice.actions

export default loginSlice.reducer
