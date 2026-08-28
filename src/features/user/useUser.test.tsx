/**
 * useUser suite.
 *
 * getUserInfo drives the fetch_user command via mockInvoke and dispatches
 * setUser; failures pass through interceptInvokeError and re-throw.
 */

import { store } from '@/app/store'
import type { User } from '@/features/user/types'
import { setUser } from '@/features/user/userSlice'
import { useUser } from '@/features/user/useUser'
import { mockInvoke, renderHookWithStore } from '@/test/test-utils'
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const loggedOutUser: User = {
  code: 0,
  message: '',
  ttl: 0,
  data: { uname: '', isLogin: false, wbiImg: { imgUrl: '', subUrl: '' } },
  hasCookie: false,
}

const loggedInUser: User = {
  code: 0,
  message: 'ok',
  ttl: 1,
  data: {
    mid: 42,
    uname: 'bilibili fan',
    isLogin: true,
    wbiImg: { imgUrl: 'img', subUrl: 'sub' },
  },
  hasCookie: true,
}

describe('useUser', () => {
  beforeEach(() => {
    store.dispatch(setUser(loggedOutUser))
    vi.clearAllMocks()
  })

  it('fetches via fetch_user, dispatches setUser, and returns the user', async () => {
    mockInvoke.mockResolvedValue(loggedInUser)
    const { result } = renderHookWithStore(() => useUser())

    let fetched: User | undefined
    await act(async () => {
      fetched = await result.current.getUserInfo()
    })

    expect(mockInvoke).toHaveBeenCalledWith('fetch_user')
    expect(fetched).toEqual(loggedInUser)
    expect(store.getState().user.data.uname).toBe('bilibili fan')
    expect(store.getState().user.data.isLogin).toBe(true)
    expect(result.current.user.data.uname).toBe('bilibili fan')
  })

  it('re-throws fetch failures and keeps the previous user state', async () => {
    mockInvoke.mockRejectedValue('ERR::UNAUTHORIZED')
    const { result } = renderHookWithStore(() => useUser())

    await act(async () => {
      await expect(result.current.getUserInfo()).rejects.toBe(
        'ERR::UNAUTHORIZED',
      )
    })

    expect(store.getState().user.data.isLogin).toBe(false)
  })

  it('onChangeUser replaces the user state', () => {
    const { result } = renderHookWithStore(() => useUser())

    act(() => {
      result.current.onChangeUser(loggedInUser)
    })

    expect(store.getState().user).toEqual(loggedInUser)
    expect(result.current.user).toEqual(loggedInUser)
  })
})
