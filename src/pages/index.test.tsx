import IndexPage from '@/pages'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

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
      <Route path="/home" element={<div>home-route</div>} />
      <Route path="/init" element={<div>init-route</div>} />
    </Routes>
  )
}

describe('IndexPage', () => {
  it('redirects to /home when the app is initialized', () => {
    vi.mocked(useInit).mockReturnValue({
      initiated: true,
    } as ReturnType<typeof useInit>)

    renderWithProviders(<Harness />, { route: '/' })

    // MemoryRouter keeps its own history, so the redirect is observed via
    // the matched route's marker element rather than window.location.
    expect(screen.getByText('home-route')).toBeInTheDocument()
    expect(screen.queryByText('init-route')).not.toBeInTheDocument()
  })

  it('redirects to /init when the app is not initialized', () => {
    vi.mocked(useInit).mockReturnValue({
      initiated: false,
    } as ReturnType<typeof useInit>)

    renderWithProviders(<Harness />, { route: '/' })

    expect(screen.getByText('init-route')).toBeInTheDocument()
    expect(screen.queryByText('home-route')).not.toBeInTheDocument()
  })
})
