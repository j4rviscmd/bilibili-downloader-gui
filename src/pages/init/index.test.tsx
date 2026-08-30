import InitPage from '@/pages/init'
import { renderWithProviders } from '@/test/test-utils'
import { useEffect } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

// initApp performs the real backend handoff (covered by useInit.test.tsx);
// the page test only needs to control its resolved result code.
vi.mock('@/features/init', () => ({
  useInit: vi.fn(),
}))

import { useInit } from '@/features/init'

/** Navigates to /init on mount, then reports where the page sent us. */
function Harness() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    navigate('/init')
  }, [navigate])

  if (location.pathname === '/init') return <InitPage />
  return <div data-testid="landing">{location.pathname}</div>
}

function HarnessWithRoutes() {
  return (
    <Routes>
      <Route path="/*" element={<Harness />} />
      <Route path="/home" element={<div data-testid="landing">/home</div>} />
      <Route path="/error" element={<div data-testid="landing">/error</div>} />
    </Routes>
  )
}

/** Reads the router location state the page passed to navigate('/error'). */
function LocationProbe() {
  const location = useLocation()
  return <div data-testid="state">{JSON.stringify(location.state)}</div>
}

function StateHarness() {
  return (
    <Routes>
      <Route path="/*" element={<Harness />} />
      <Route
        path="/error"
        element={
          <>
            <div data-testid="landing">/error</div>
            <LocationProbe />
          </>
        }
      />
    </Routes>
  )
}

/** Installs a useInit mock resolving initApp with the given result. */
function mockUseInit(
  initiated: boolean,
  initResult: { code: number; detail?: string },
) {
  vi.mocked(useInit).mockReturnValue({
    initiated,
    setInitiated: vi.fn(),
    initApp: vi.fn().mockResolvedValue(initResult),
    quitApp: vi.fn(),
  } as ReturnType<typeof useInit>)
}

describe('InitPage', () => {
  it('navigates to /home when initApp succeeds (code 0)', async () => {
    mockUseInit(true, { code: 0 })

    const { findByTestId } = renderWithProviders(<HarnessWithRoutes />, {
      route: '/',
    })

    expect(await findByTestId('landing')).toHaveTextContent('/home')
  })

  it('navigates to /error with code and detail when initApp fails', async () => {
    mockUseInit(false, { code: 2, detail: 'cookie stale' })

    const { findByTestId } = renderWithProviders(<StateHarness />, {
      route: '/',
    })

    expect(await findByTestId('landing')).toHaveTextContent('/error')
    const stateEl = await findByTestId('state')
    expect(JSON.parse(stateEl.textContent ?? '')).toEqual({
      errorCode: 2,
      errorDetail: 'cookie stale',
    })
  })

  it('maps an out-of-range error code to 255', async () => {
    mockUseInit(false, { code: 99 })

    const { findByTestId } = renderWithProviders(<StateHarness />, {
      route: '/',
    })

    await findByTestId('landing')
    const state = JSON.parse(
      (await findByTestId('state')).textContent ?? '',
    ) as { errorCode: number }
    expect(state.errorCode).toBe(255)
  })
})
