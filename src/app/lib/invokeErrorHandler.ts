import { refreshCookie, setSession } from '@/features/login'
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

/** Mutex to prevent concurrent refresh attempts. */
let refreshInProgress: Promise<boolean> | null = null

/**
 * Attempts a cookie refresh exactly once per batch of concurrent
 * `-101` errors. Subsequent callers share the same promise.
 */
async function tryRefreshOnce(): Promise<boolean> {
  if (refreshInProgress) return refreshInProgress

  refreshInProgress = (async () => {
    try {
      await refreshCookie()
      return true
    } catch {
      return false
    } finally {
      refreshInProgress = null
    }
  })()

  return refreshInProgress
}

/**
 * Handles session expiry when the backend returns ERR::UNAUTHORIZED.
 *
 * Attempts to refresh the session using the stored refresh_token
 * before falling back to logout. If the refresh succeeds the user
 * stays logged in; otherwise the session is cleared.
 *
 * Only shows a toast notification if the user was previously logged in
 * (`user.data.isLogin === true`), preventing duplicate notifications.
 *
 * @param store - Redux store instance (or compatible subset)
 */
export async function handleSessionExpiry(store: SessionStore): Promise<void> {
  const state = store.getState()
  const wasLoggedIn = state.user.data.isLogin

  if (!wasLoggedIn) return

  const refreshed = await tryRefreshOnce()

  if (refreshed) {
    toast.info(i18n.t('login.cookie_refreshed'))
    return
  }

  toast.warning(i18n.t('login.session_expired'))
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
 *   const errorString = await interceptInvokeError(store, err)
 *   if (errorString) dispatch(setError(errorString))
 * }
 * ```
 */
export async function interceptInvokeError(
  store: SessionStore,
  error: unknown,
): Promise<string | null> {
  const errorString = error instanceof Error ? error.message : String(error)

  if (isUnauthorizedError(errorString)) {
    await handleSessionExpiry(store)
    return null
  }

  return errorString
}
