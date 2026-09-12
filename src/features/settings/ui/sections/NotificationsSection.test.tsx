/**
 * NotificationsSection suite: both taskbar switches persist their patch.
 */

import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationsSection } from './NotificationsSection'

const baseline: Settings = {
  dlOutputPath: '/downloads/out',
  language: 'ja',
  fontSize: 14,
  trimMode: 'copy',
  audioFormat: 'mp3',
  theme: 'light',
}

/** Returns the latest patch_settings payload (changed fields), or undefined. */
function lastSetSettings(): Partial<Settings> | undefined {
  const calls = mockInvoke.mock.calls.filter(
    (c: unknown[]) => c[0] === 'patch_settings',
  )
  const call = calls[calls.length - 1]
  return call?.[1]?.patch as Partial<Settings> | undefined
}

describe('NotificationsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(undefined)
    store.dispatch(setSettings(baseline))
  })

  it.each([
    ['settings.taskbar_progress_label', { showTaskbarProgress: false }],
    [
      'settings.flash_taskbar_on_complete_label',
      { flashTaskbarOnComplete: false },
    ],
  ])('toggling %s persists it', async (labelKey, expected) => {
    const { user } = renderWithProviders(<NotificationsSection />)

    const section = screen
      .getByText(labelKey)
      .closest('div.flex.items-center.justify-between')!
    await user.click(
      section.querySelector('button[role="switch"]') as HTMLElement,
    )

    await waitFor(() => expect(lastSetSettings()).toMatchObject(expected))
  })
})
