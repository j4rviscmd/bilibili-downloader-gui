import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import IndexPage from '@/pages'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The page only consumes `initiated`; the hook itself is covered by
// useInit.test.tsx, so the module is stubbed to control that one flag.
vi.mock('@/features/init', () => ({
  useInit: vi.fn(),
}))

import { useInit } from '@/features/init'

/** Route table with marker elements so redirects are observable. */
function Harness() {
  return (
    <Routes>
      <Route path="/" element={<IndexPage />} />
      <Route path="/search" element={<div>search-route</div>} />
      <Route path="/video-search" element={<div>video-search-route</div>} />
      <Route path="/init" element={<div>init-route</div>} />
    </Routes>
  )
}

describe('IndexPage', () => {
  beforeEach(() => {
    // Isolate tests from each other's startup-page mutations on the real
    // singleton store.
    store.dispatch(setSettings({ startupPage: '/search' }))
  })

  it('redirects to /search when initialized with the default startup page', () => {
    vi.mocked(useInit).mockReturnValue({
      initiated: true,
    } as ReturnType<typeof useInit>)

    renderWithProviders(<Harness />, { route: '/' })

    // MemoryRouter keeps its own history, so the redirect is observed via
    // the matched route's marker element rather than window.location.
    expect(screen.getByText('search-route')).toBeInTheDocument()
    expect(screen.queryByText('init-route')).not.toBeInTheDocument()
  })

  it('redirects to the configured startup page when initialized', () => {
    vi.mocked(useInit).mockReturnValue({
      initiated: true,
    } as ReturnType<typeof useInit>)
    store.dispatch(setSettings({ startupPage: '/video-search' }))

    renderWithProviders(<Harness />, { route: '/' })

    expect(screen.getByText('video-search-route')).toBeInTheDocument()
  })

  it('falls back to /search for an unknown startup page', () => {
    vi.mocked(useInit).mockReturnValue({
      initiated: true,
    } as ReturnType<typeof useInit>)
    store.dispatch(setSettings({ startupPage: '/deleted-page' }))

    renderWithProviders(<Harness />, { route: '/' })

    expect(screen.getByText('search-route')).toBeInTheDocument()
  })

  it('redirects to /init when the app is not initialized', () => {
    vi.mocked(useInit).mockReturnValue({
      initiated: false,
    } as ReturnType<typeof useInit>)

    renderWithProviders(<Harness />, { route: '/' })

    expect(screen.getByText('init-route')).toBeInTheDocument()
    expect(screen.queryByText('search-route')).not.toBeInTheDocument()
  })
})
