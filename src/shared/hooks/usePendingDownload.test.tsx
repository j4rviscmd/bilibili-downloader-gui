/**
 * usePendingDownload suite.
 *
 * Asserts the setPendingDownload dispatch on the real store and the
 * navigation to /home through MemoryRouter.
 */

import { store } from '@/app/store'
import { resetInput } from '@/features/video/model/inputSlice'
import { usePendingDownload } from '@/shared/hooks/usePendingDownload'
import { act, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>
    <MemoryRouter initialEntries={['/watch-history']}>
      <Routes>
        <Route path="/home" element={<div>home-page</div>} />
        <Route path="*" element={children} />
      </Routes>
    </MemoryRouter>
  </Provider>
)

describe('usePendingDownload', () => {
  beforeEach(() => {
    store.dispatch(resetInput())
  })

  it('stores the pending download and navigates to /home', () => {
    const { result } = renderHook(() => usePendingDownload(), { wrapper })

    act(() => {
      result.current('BV1xx411c7XD', 12345, 2)
    })

    expect(store.getState().input.pendingDownload).toEqual({
      bvid: 'BV1xx411c7XD',
      cid: 12345,
      page: 2,
    })
    expect(screen.getByText('home-page')).toBeTruthy()
  })

  it('accepts a null cid (favorites entry point)', () => {
    const { result } = renderHook(() => usePendingDownload(), { wrapper })

    act(() => {
      result.current('BV1favoritE', null, 1)
    })

    expect(store.getState().input.pendingDownload).toEqual({
      bvid: 'BV1favoritE',
      cid: null,
      page: 1,
    })
    expect(screen.getByText('home-page')).toBeTruthy()
  })
})
