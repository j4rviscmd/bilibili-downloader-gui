import type { User } from '@/features/user/types'
import { mockInvoke } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchUser } from './fetchUser'

const mockUser: User = {
  code: 0,
  message: '0',
  ttl: 1,
  data: {
    mid: 42,
    uname: 'TestUser',
    isLogin: true,
    wbiImg: { imgUrl: '', subUrl: '' },
  },
  hasCookie: true,
}

describe('fetchUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call invoke with fetch_user command', async () => {
    mockInvoke.mockResolvedValue(mockUser)

    const result = await fetchUser()

    expect(mockInvoke).toHaveBeenCalledWith('fetch_user')
    expect(result).toEqual(mockUser)
  })

  it('should return logged-out user object when cookies are unavailable', async () => {
    const loggedOut: User = {
      ...mockUser,
      hasCookie: false,
      data: { ...mockUser.data, isLogin: false, mid: undefined },
    }
    mockInvoke.mockResolvedValue(loggedOut)

    const result = await fetchUser()

    expect(result.hasCookie).toBe(false)
    expect(result.data.isLogin).toBe(false)
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue('ERR::UNAUTHORIZED')

    await expect(fetchUser()).rejects.toBe('ERR::UNAUTHORIZED')
  })
})
