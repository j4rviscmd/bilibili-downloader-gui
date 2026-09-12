import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { useLocation } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'

import { formatKbps, SpeedLimitLink } from './SpeedLimitLink'

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

describe('SpeedLimitLink', () => {
  beforeEach(() => {
    mockInvoke.mockResolvedValue(undefined)
    store.dispatch(
      setSettings({
        downloadSpeedLimitEnabled: false,
        downloadSpeedLimitKbps: 1000,
      }),
    )
  })

  it('shows a set-limit entry point while unlimited, deep-linking into Settings', async () => {
    const { user } = renderWithProviders(
      <>
        <SpeedLimitLink />
        <LocationProbe />
      </>,
    )

    const link = screen.getByTestId('speed-limit-link')
    expect(link).toHaveTextContent('downloadStatus.speed_limit_set')
    await user.click(link)

    expect(await screen.findByTestId('location-probe')).toHaveTextContent(
      '/settings?category=download&anchor=speed-limit',
    )
  })

  it('shows the current limit and deep-links into Settings on click', async () => {
    store.dispatch(
      setSettings({
        downloadSpeedLimitEnabled: true,
        downloadSpeedLimitKbps: 500,
      }),
    )

    const { user } = renderWithProviders(
      <>
        <SpeedLimitLink />
        <LocationProbe />
      </>,
    )

    const link = screen.getByTestId('speed-limit-link')
    expect(link).toHaveTextContent('500 KB/s')
    await user.click(link)

    expect(await screen.findByTestId('location-probe')).toHaveTextContent(
      '/settings?category=download&anchor=speed-limit',
    )
  })

  it('scales the display unit at 1000 kb/s (decimal, one fraction digit)', () => {
    const cases: Array<[number, string]> = [
      [100, '100 KB/s'],
      [999, '999 KB/s'],
      [1000, '1 MB/s'],
      [1500, '1.5 MB/s'],
      [10000, '10 MB/s'],
      [10000000, '10,000 MB/s'],
    ]
    for (const [kbps, expected] of cases) {
      expect(formatKbps(kbps)).toBe(expected)
    }
  })
})
