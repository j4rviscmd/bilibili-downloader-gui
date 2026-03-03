/**
 * Login Redux Slice
 *
 * This slice manages the state for QR code-based Bilibili authentication.
 * It handles the complete login flow including QR code generation,
 * status polling, session management, and error handling.
 *
 * @module loginSlice
 *
 * @example
 * ```typescript
 * import { useDispatch, useSelector } from 'react-redux'
 * import { setQrCode, setQrStatus } from '@/features/login'
 *
 * function LoginComponent() {
 *   const dispatch = useDispatch()
 *   const { qrCodeImage, qrStatus } = useSelector((state) => state.login)
 *
 *   const handleGenerate = () => {
 *     dispatch(setQrCode({ image: 'data:image/png;base64,...', key: 'abc123' }))
 *   }
 *
 *   return <div>{qrCodeImage && <img src={qrCodeImage} />}</div>
 * }
 * ```
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit'
import type { LoginMethod, QrCodeStatus, QrSession } from '../api/loginApi'

/**
 * State shape for the login slice.
 *
 * Manages all aspects of the QR code login flow including the current QR code image,
 * polling status, session data, and error states.
 *
 * @interface LoginSliceState
 * @property {QrCodeStatus | null} qrStatus - Current QR code authentication status
 * @property {string | null} qrCodeImage - Base64-encoded QR code image data URL
 * @property {string | null} qrcodeKey - Unique key for polling login status
 * @property {string} statusMessage - Human-readable status message from backend
 * @property {LoginMethod} loginMethod - User's preferred login method ('firefox' or 'qrCode')
 * @property {QrSession | null} qrSession - Active QR session data after successful login
 * @property {boolean} isQrLoading - Whether a QR code is currently being generated
 * @property {string | null} error - Error message if login failed, null otherwise
 */
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
  /** Current QR session (if logged in via QR) */
  qrSession: QrSession | null
  /** Whether QR login is in progress */
  isQrLoading: boolean
  /** Error message if any */
  error: string | null
}

/**
 * Initial state for the login slice.
 *
 * Starts with no active session, Firefox as the default login method,
 * and all nullable fields set to null.
 */
const initialState: LoginSliceState = {
  qrStatus: null,
  qrCodeImage: null,
  qrcodeKey: null,
  statusMessage: '',
  loginMethod: 'firefox',
  qrSession: null,
  isQrLoading: false,
  error: null,
}

/**
 * Redux slice for login state management.
 *
 * Provides actions for:
 * - Setting QR code image and key after generation
 * - Updating login status during polling
 * - Managing session data after successful login
 * - Handling errors and loading states
 * - Clearing login state
 */
const loginSlice = createSlice({
  name: 'login',
  initialState,
  reducers: {
    /**
     * Sets the QR code image and key.
     *
     * Called after successful QR code generation. Resets the status to 'waitingForScan'
     * and clears any previous errors.
     *
     * @param {LoginSliceState} state - Current state
     * @param {PayloadAction<{ image: string; key: string }>} action - Action containing image data URL and polling key
     */
    setQrCode(state, action: PayloadAction<{ image: string; key: string }>) {
      state.qrCodeImage = action.payload.image
      state.qrcodeKey = action.payload.key
      state.qrStatus = 'waitingForScan'
      state.statusMessage = ''
      state.error = null
    },
    /**
     * Updates the QR code login status.
     *
     * Called during polling to reflect the current authentication state.
     *
     * @param {LoginSliceState} state - Current state
     * @param {PayloadAction<{ status: QrCodeStatus; message: string }>} action - Action containing status and message
     */
    setQrStatus(
      state,
      action: PayloadAction<{ status: QrCodeStatus; message: string }>,
    ) {
      state.qrStatus = action.payload.status
      state.statusMessage = action.payload.message
    },
    /**
     * Sets the preferred login method.
     *
     * Updates the user's login method preference for future logins.
     *
     * @param {LoginSliceState} state - Current state
     * @param {PayloadAction<LoginMethod>} action - Action containing the login method to set
     */
    setLoginMethod(state, action: PayloadAction<LoginMethod>) {
      state.loginMethod = action.payload
    },
    /**
     * Sets the QR session data.
     *
     * Called after successful login to store the session data.
     * Note: qrStatus is managed separately via setQrStatus from polling.
     *
     * @param {LoginSliceState} state - Current state
     * @param {PayloadAction<QrSession | null>} action - Action containing session data or null to clear
     */
    setQrSession(state, action: PayloadAction<QrSession | null>) {
      state.qrSession = action.payload
      // Note: qrStatus is managed separately via setQrStatus from polling
    },
    /**
     * Sets the QR code loading state.
     *
     * Indicates whether a QR code is currently being generated.
     *
     * @param {LoginSliceState} state - Current state
     * @param {PayloadAction<boolean>} action - Action containing the loading state
     */
    setQrLoading(state, action: PayloadAction<boolean>) {
      state.isQrLoading = action.payload
    },
    /**
     * Sets an error message.
     *
     * Called when an error occurs during the login flow.
     * Automatically sets isQrLoading to false.
     *
     * @param {LoginSliceState} state - Current state
     * @param {PayloadAction<string | null>} action - Action containing error message or null to clear
     */
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload
      state.isQrLoading = false
    },
    /**
     * Clears the QR code and related state.
     *
     * Resets all QR code-related fields to their initial values.
     * Does not affect loginMethod preference.
     *
     * @param {LoginSliceState} state - Current state
     */
    clearQrCode(state) {
      state.qrCodeImage = null
      state.qrcodeKey = null
      state.qrStatus = null
      state.statusMessage = ''
      state.isQrLoading = false
      state.qrSession = null
    },
    /**
     * Resets the entire login state to initial values.
     *
     * Complete reset including loginMethod preference.
     *
     * @param {LoginSliceState} state - Current state
     */
    resetLogin(state) {
      Object.assign(state, initialState)
    },
  },
})

/**
 * Exported action creators for the login slice.
 */
export const {
  setQrCode,
  setQrStatus,
  setLoginMethod,
  setQrSession,
  setQrLoading,
  setError,
  clearQrCode,
  resetLogin,
} = loginSlice.actions

/**
 * The login reducer to be added to the Redux store.
 */
export default loginSlice.reducer
