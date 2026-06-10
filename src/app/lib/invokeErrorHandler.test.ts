import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRefreshCookie } = vi.hoisted(() => ({
  mockRefreshCookie: vi.fn(),
}))

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}))

// Mock i18n
vi.mock('@/i18n', () => ({
  default: {
    t: vi.fn((key: string) => key),
  },
}))

// Mock Redux actions
vi.mock('@/features/user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/user')>()
  return {
    ...actual,
    setUser: vi.fn((payload) => ({
      type: 'user/setUser',
      payload,
    })),
  }
})

vi.mock('@/features/login', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/login')>()
  return {
    ...actual,
    setSession: vi.fn((payload) => ({
      type: 'login/setSession',
      payload,
    })),
    refreshCookie: mockRefreshCookie,
  }
})

import { toast } from 'sonner'
import {
  handleSessionExpiry,
  interceptInvokeError,
  isUnauthorizedError,
  type SessionStore,
  UNAUTHORIZED_ERROR,
} from './invokeErrorHandler'

const mockToastWarning = toast.warning as unknown as ReturnType<typeof vi.fn>
const mockToastInfo = toast.info as unknown as ReturnType<typeof vi.fn>

/**
 * Creates a mock SessionStore with the given login state.
 */
function createMockStore(isLogin: boolean): SessionStore & {
  dispatched: unknown[]
} {
  const dispatched: unknown[] = []
  return {
    dispatched,
    getState: () => ({
      user: {
        code: 0,
        message: '',
        ttl: 0,
        data: {
          uname: isLogin ? 'TestUser' : '',
          isLogin,
          wbiImg: { imgUrl: '', subUrl: '' },
        },
        hasCookie: isLogin,
      },
    }),
    dispatch: (action: unknown) => {
      dispatched.push(action)
    },
  }
}

describe('invokeErrorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('UNAUTHORIZED_ERROR', () => {
    it('should be ERR::UNAUTHORIZED', () => {
      expect(UNAUTHORIZED_ERROR).toBe('ERR::UNAUTHORIZED')
    })
  })

  describe('isUnauthorizedError', () => {
    it('should return true for exact match', () => {
      expect(isUnauthorizedError('ERR::UNAUTHORIZED')).toBe(true)
    })

    it('should return true when embedded in longer string', () => {
      expect(
        isUnauthorizedError('ERR::UNAUTHORIZED (code -101): 账号未登录'),
      ).toBe(true)
    })

    it('should return false for other errors', () => {
      expect(isUnauthorizedError('ERR::VIDEO_NOT_FOUND')).toBe(false)
    })

    it('should return false for empty string', () => {
      expect(isUnauthorizedError('')).toBe(false)
    })

    it('should return false for partial match', () => {
      expect(isUnauthorizedError('UNAUTHORIZED')).toBe(false)
    })
  })

  describe('handleSessionExpiry', () => {
    it('should show info toast and NOT log out when refresh succeeds', async () => {
      mockRefreshCookie.mockResolvedValue({ sessdata: 'new' })
      const mockStore = createMockStore(true)

      await handleSessionExpiry(mockStore)

      expect(mockRefreshCookie).toHaveBeenCalled()
      expect(mockToastInfo).toHaveBeenCalledWith('login.cookie_refreshed')
      expect(mockToastWarning).not.toHaveBeenCalled()
      expect(mockStore.dispatched.length).toBe(0)
    })

    it('should show warning toast and log out when refresh fails', async () => {
      mockRefreshCookie.mockRejectedValue(new Error('refresh failed'))
      const mockStore = createMockStore(true)

      await handleSessionExpiry(mockStore)

      expect(mockRefreshCookie).toHaveBeenCalled()
      expect(mockToastWarning).toHaveBeenCalledWith('login.session_expired')

      const setUserAction = mockStore.dispatched.find(
        (a: unknown) => (a as { type: string }).type === 'user/setUser',
      ) as { type: string; payload: { data: { isLogin: boolean } } }
      expect(setUserAction).toBeDefined()
      expect(setUserAction.payload.data.isLogin).toBe(false)

      const setSessionAction = mockStore.dispatched.find(
        (a: unknown) => (a as { type: string }).type === 'login/setSession',
      ) as { type: string; payload: null }
      expect(setSessionAction).toBeDefined()
      expect(setSessionAction.payload).toBeNull()
    })

    it('should NOT show toast when user was already logged out', async () => {
      const mockStore = createMockStore(false)

      await handleSessionExpiry(mockStore)

      expect(mockToastWarning).not.toHaveBeenCalled()
      expect(mockToastInfo).not.toHaveBeenCalled()
      expect(mockStore.dispatched.length).toBe(0)
    })

    it('should preserve user data except isLogin on logout', async () => {
      mockRefreshCookie.mockRejectedValue(new Error('refresh failed'))
      const mockStore = createMockStore(true)

      await handleSessionExpiry(mockStore)

      const setUserAction = mockStore.dispatched.find(
        (a: unknown) => (a as { type: string }).type === 'user/setUser',
      ) as {
        type: string
        payload: { data: { uname: string; isLogin: boolean } }
      }
      expect(setUserAction.payload.data.uname).toBe('TestUser')
      expect(setUserAction.payload.data.isLogin).toBe(false)
    })

    it('should only refresh once for concurrent calls', async () => {
      mockRefreshCookie.mockResolvedValue({ sessdata: 'new' })
      const mockStore = createMockStore(true)

      await Promise.all([
        handleSessionExpiry(mockStore),
        handleSessionExpiry(mockStore),
        handleSessionExpiry(mockStore),
      ])

      expect(mockRefreshCookie).toHaveBeenCalledTimes(1)
    })
  })

  describe('interceptInvokeError', () => {
    it('should return error string for string errors', async () => {
      const mockStore = createMockStore(false)

      const result = await interceptInvokeError(
        mockStore,
        'ERR::VIDEO_NOT_FOUND',
      )

      expect(result).toBe('ERR::VIDEO_NOT_FOUND')
    })

    it('should return error message for Error instances', async () => {
      const mockStore = createMockStore(false)

      const result = await interceptInvokeError(
        mockStore,
        new Error('Something failed'),
      )

      expect(result).toBe('Something failed')
    })

    it('should handle non-string/non-Error values', async () => {
      const mockStore = createMockStore(false)

      const result = await interceptInvokeError(mockStore, 42)

      expect(result).toBe('42')
    })

    it('should trigger session refresh for ERR::UNAUTHORIZED', async () => {
      mockRefreshCookie.mockResolvedValue({ sessdata: 'new' })
      const mockStore = createMockStore(true)

      const result = await interceptInvokeError(mockStore, 'ERR::UNAUTHORIZED')

      expect(result).toBeNull()
      expect(mockRefreshCookie).toHaveBeenCalled()
      expect(mockToastInfo).toHaveBeenCalledWith('login.cookie_refreshed')
    })

    it('should NOT trigger session expiry for other errors', async () => {
      const mockStore = createMockStore(true)

      const result = await interceptInvokeError(mockStore, 'ERR::API_ERROR')

      expect(result).toBe('ERR::API_ERROR')
      expect(mockToastWarning).not.toHaveBeenCalled()
      expect(mockStore.dispatched.length).toBe(0)
    })

    it('should handle ERR::UNAUTHORIZED in Error message', async () => {
      mockRefreshCookie.mockResolvedValue({ sessdata: 'new' })
      const mockStore = createMockStore(true)

      const result = await interceptInvokeError(
        mockStore,
        new Error('ERR::UNAUTHORIZED (code -101)'),
      )

      expect(result).toBeNull()
      expect(mockRefreshCookie).toHaveBeenCalled()
    })
  })
})
