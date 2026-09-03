/**
 * SidebarProvider persistence suite (issue #563).
 *
 * Persisting the sidebar open/close state goes through the
 * `patch_settings` field patch — this pins the payload shape so a
 * regression to a whole-object save (or a broken key) cannot slip in
 * unnoticed.
 */

import { store } from '@/app/store'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { SidebarProvider, useSidebar } from './sidebar'

/** Renders a button inside the provider that closes the sidebar on click. */
function Probe() {
  const { setOpen } = useSidebar()
  return (
    <button type="button" onClick={() => setOpen(false)}>
      close-sidebar
    </button>
  )
}

describe('SidebarProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(undefined)
  })

  it('persists open/close via patch_settings with only sidebarExpanded', async () => {
    const { user } = renderWithProviders(
      <SidebarProvider>
        <Probe />
      </SidebarProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'close-sidebar' }))

    // Field patch only (issue #563): never a whole-settings object, which
    // would overwrite fields saved by another app instance.
    expect(mockInvoke).toHaveBeenCalledWith('patch_settings', {
      patch: { sidebarExpanded: false },
    })
    // The Redux sidebar state updates alongside the persistence call.
    expect(store.getState().sidebar.sidebarOpen).toBe(false)
  })
})
