import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { describe, expect, it } from 'vitest'

import {
  HistoryNavigation,
  resolveHistoryAvailability,
} from './HistoryNavigation'

describe('resolveHistoryAvailability', () => {
  it('disables both directions at the initial entry', () => {
    expect(
      resolveHistoryAvailability({ state: { idx: 0 }, length: 1 }),
    ).toEqual({ back: false, forward: false })
  })

  it('enables back after the first push', () => {
    expect(
      resolveHistoryAvailability({ state: { idx: 1 }, length: 2 }),
    ).toEqual({ back: true, forward: false })
  })

  it('enables forward after going back', () => {
    expect(
      resolveHistoryAvailability({ state: { idx: 0 }, length: 2 }),
    ).toEqual({ back: false, forward: true })
  })

  it('treats a missing idx as the initial entry', () => {
    expect(resolveHistoryAvailability({ state: null, length: 3 })).toEqual({
      back: false,
      forward: true,
    })
  })
})

/**
 * Renders HistoryNavigation with the current pathname echoed out.
 *
 * MemoryRouter never touches window.history, so the browser-history
 * index the component reads is seeded manually to emulate a pushed
 * entry (react-router stores idx in window.history.state.idx).
 */
function Harness() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    navigate('/downloads')
    window.history.replaceState({ idx: 1 }, '')
  }, [navigate])

  return (
    <>
      <HistoryNavigation />
      <div data-testid="location">{location.pathname}</div>
    </>
  )
}

describe('HistoryNavigation', () => {
  it('disables both buttons at the initial entry', () => {
    renderWithProviders(<HistoryNavigation />)

    expect(
      screen.getByRole('button', { name: 'nav.aria.goBack' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'nav.aria.goForward' }),
    ).toBeDisabled()
  })

  it('navigates back through the history stack on click', async () => {
    const { user } = renderWithProviders(<Harness />)

    expect(screen.getByTestId('location')).toHaveTextContent('/downloads')

    await user.click(screen.getByRole('button', { name: 'nav.aria.goBack' }))

    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })
})
