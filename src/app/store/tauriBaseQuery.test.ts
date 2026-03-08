import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock @tauri-apps/api/core before importing tauriBaseQuery
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
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

import { store } from '@/app/store'
import type { User } from '@/features/user/types'
import { setUser } from '@/features/user/userSlice'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { tauriBaseQuery } from './tauriBaseQuery'

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>
const mockToastWarning = toast.warning as unknown as ReturnType<typeof vi.fn>

/**
 * Creates a User object with the specified login state.
 */
function createUser(isLogin: boolean): User {
  return {
    code: 0,
    message: '',
    ttl: 0,
    data: {
      uname: isLogin ? 'TestUser' : '',
      isLogin,
      wbiImg: { imgUrl: '', subUrl: '' },
    },
    hasCookie: isLogin,
  }
}

describe('tauriBaseQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset user state to logged out
    store.dispatch(setUser(createUser(false)))
  })

  it('should return data on successful invoke', async () => {
    const mockData = { title: 'Test Video' }
    mockInvoke.mockResolvedValue(mockData)

    const result = await tauriBaseQuery(
      { command: 'fetch_video_info', args: { videoId: 'BV123' } },
      {} as never,
      {},
    )

    expect(mockInvoke).toHaveBeenCalledWith('fetch_video_info', {
      videoId: 'BV123',
    })
    expect(result).toEqual({ data: mockData })
  })

  it('should return error string on invoke failure', async () => {
    mockInvoke.mockRejectedValue('ERR::VIDEO_NOT_FOUND')

    const result = await tauriBaseQuery(
      { command: 'fetch_video_info', args: { videoId: 'invalid' } },
      {} as never,
      {},
    )

    expect(result).toEqual({ error: 'ERR::VIDEO_NOT_FOUND' })
  })

  describe('session expiry handling', () => {
    it('should show toast and reset state when ERR::UNAUTHORIZED while logged in', async () => {
      // Set user as logged in
      store.dispatch(setUser(createUser(true)))
      mockInvoke.mockRejectedValue('ERR::UNAUTHORIZED')

      const result = await tauriBaseQuery(
        { command: 'fetch_video_info', args: {} },
        {} as never,
        {},
      )

      // Should show warning toast
      expect(mockToastWarning).toHaveBeenCalledWith('login.session_expired')

      // Should reset user login state
      const state = store.getState()
      expect(state.user.data.isLogin).toBe(false)

      // Should clear session
      expect(state.login.session).toBeNull()

      // Should still return the error
      expect(result).toEqual({ error: 'ERR::UNAUTHORIZED' })
    })

    it('should NOT show toast when ERR::UNAUTHORIZED while already logged out', async () => {
      // User is already logged out (default state from beforeEach)
      mockInvoke.mockRejectedValue('ERR::UNAUTHORIZED')

      await tauriBaseQuery(
        { command: 'fetch_video_info', args: {} },
        {} as never,
        {},
      )

      // Should NOT show toast since user was already logged out
      expect(mockToastWarning).not.toHaveBeenCalled()

      // State should remain logged out
      const state = store.getState()
      expect(state.user.data.isLogin).toBe(false)
    })

    it('should handle ERR::UNAUTHORIZED embedded in longer error strings', async () => {
      store.dispatch(setUser(createUser(true)))
      mockInvoke.mockRejectedValue('ERR::UNAUTHORIZED (code -101): 账号未登录')

      const result = await tauriBaseQuery(
        { command: 'fetch_video_info', args: {} },
        {} as never,
        {},
      )

      expect(mockToastWarning).toHaveBeenCalled()
      expect(store.getState().user.data.isLogin).toBe(false)
      expect(result.error).toContain('ERR::UNAUTHORIZED')
    })

    it('should NOT trigger session expiry for other errors', async () => {
      store.dispatch(setUser(createUser(true)))
      mockInvoke.mockRejectedValue('ERR::API_ERROR')

      await tauriBaseQuery(
        { command: 'fetch_video_info', args: {} },
        {} as never,
        {},
      )

      // Should NOT show toast for non-unauthorized errors
      expect(mockToastWarning).not.toHaveBeenCalled()

      // User should still be logged in
      expect(store.getState().user.data.isLogin).toBe(true)
    })

    it('should preserve user data (except isLogin) when resetting state', async () => {
      const loggedInUser = createUser(true)
      loggedInUser.data.uname = 'TestUser123'
      loggedInUser.data.mid = 12345
      store.dispatch(setUser(loggedInUser))
      mockInvoke.mockRejectedValue('ERR::UNAUTHORIZED')

      await tauriBaseQuery(
        { command: 'fetch_video_info', args: {} },
        {} as never,
        {},
      )

      const state = store.getState()
      expect(state.user.data.isLogin).toBe(false)
      // uname is preserved from the state snapshot
      expect(state.user.data.uname).toBe('TestUser123')
    })
  })
})
