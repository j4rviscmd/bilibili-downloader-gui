import { setSession } from '@/features/login'
import type { User } from '@/features/user'
import { setUser } from '@/features/user'
import i18n from '@/i18n'
import { toast } from 'sonner'

/**
 * Error code prefix returned by Rust backend for unauthorized
 * (Bilibili API code -101).
 */
export const UNAUTHORIZED_ERROR = 'ERR::UNAUTHORIZED'

/**
 * Checks whether an error string contains `ERR::UNAUTHORIZED`.
 *
 * @param error - Raw error string from Tauri invoke
 * @returns `true` when the error indicates an expired session
 */
export function isUnauthorizedError(error: string): boolean {
  return error.includes(UNAUTHORIZED_ERROR)
}

/**
 * Minimal store interface needed by session expiry handling.
 *
 * Decoupled from the concrete Redux store type so that
 * this module avoids importing from `app/store` directly
 * (which would create a circular dependency).
 */
export type SessionStore = {
  getState: () => { user: User }
  dispatch: (action: unknown) => void
}

/**
 * Handles session expiry when the backend returns ERR::UNAUTHORIZED.
 *
 * Only shows a toast notification if the user was previously logged in
 * (`user.data.isLogin === true`), preventing duplicate notifications.
 * Resets login status and session to logged-out state while preserving
 * other user data (uname, face, etc.).
 *
 * This function accesses the Redux store directly (not via hooks) so it
 * can be called from both React component context and non-component
 * code such as RTK Query base queries.
 *
 * @param store - Redux store instance (or compatible subset)
 */
export function handleSessionExpiry(store: SessionStore): void {
  const state = store.getState()
  const wasLoggedIn = state.user.data.isLogin

  if (wasLoggedIn) {
    toast.warning(i18n.t('login.session_expired'))
  }

  store.dispatch(
    setUser({
      ...state.user,
      data: { ...state.user.data, isLogin: false },
    }),
  )
  store.dispatch(setSession(null))
}

/**
 * Intercepts an invoke error and triggers session expiry handling
 * when `ERR::UNAUTHORIZED` is detected.
 *
 * Call this inside `catch` blocks that wrap direct `invoke()` calls
 * to Bilibili APIs. It converts the error to a string, checks for
 * the unauthorized code, and delegates to {@link handleSessionExpiry}.
 *
 * Returns `null` when the error was an unauthorized session expiry
 * (already handled with a toast), so callers can skip their own
 * error display logic.
 *
 * @param store - Redux store instance (or compatible subset)
 * @param error - The caught error (any type)
 * @returns The error string, or `null` if session expiry was handled
 *
 * @example
 * ```typescript
 * try {
 *   const data = await invoke('fetch_watch_history', { max: 20 })
 * } catch (err) {
 *   const errorString = interceptInvokeError(store, err)
 *   if (errorString) dispatch(setError(errorString))
 * }
 * ```
 */
export function interceptInvokeError(
  store: SessionStore,
  error: unknown,
): string | null {
  const errorString = error instanceof Error ? error.message : String(error)

  if (isUnauthorizedError(errorString)) {
    handleSessionExpiry(store)
    return null
  }

  return errorString
}
