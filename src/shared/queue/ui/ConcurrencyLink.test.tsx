import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { useLocation } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'

import { ConcurrencyLink } from './ConcurrencyLink'

/** Renders the in-router location so tests can assert navigation targets. */
function LocationProbe() {
  const { pathname, search } = useLocation()
  return (
    <span data-testid="location-probe">
      {pathname}
      {search}
    </span>
  )
}

describe('ConcurrencyLink', () => {
  beforeEach(() => {
    mockInvoke.mockResolvedValue(undefined)
    store.dispatch(setSettings({ maxConcurrentDownloads: 2 }))
  })

  it('renders the live cap and deep-links to the concurrency setting', async () => {
    store.dispatch(setSettings({ maxConcurrentDownloads: 3 }))
    const { user } = renderWithProviders(
      <>
        <ConcurrencyLink />
        <LocationProbe />
      </>,
    )

    const link = screen.getByTestId('concurrency-link')
    expect(screen.getByTestId('concurrency-badge')).toHaveTextContent('3')
    // aria-label carries the cap for screen readers (the badge digit is
    // visual only).
    expect(link).toHaveAttribute(
      'aria-label',
      'downloadStatus.concurrent_downloads_tooltip ×3',
    )
    await user.click(link)

    expect(await screen.findByTestId('location-probe')).toHaveTextContent(
      '/settings?category=download&anchor=max-concurrent-downloads',
    )
  })

  it('clamps a hand-edited out-of-range value for display', () => {
    store.dispatch(setSettings({ maxConcurrentDownloads: 7 }))
    renderWithProviders(
      <>
        <ConcurrencyLink />
        <LocationProbe />
      </>,
    )

    // Mirror of the runner's 1..4 clamp — the badge must agree with the
    // effective slot count even on a hand-edited settings.json.
    expect(screen.getByTestId('concurrency-badge')).toHaveTextContent('4')
  })
})
