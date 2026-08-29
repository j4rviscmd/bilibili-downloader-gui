/**
 * Settings dialog wiring suite.
 *
 * Covers both halves of the open/close contract:
 * - OpenSettingsDialogButton flips settings.dialogOpen (requires a
 *   SidebarProvider ancestor for SidebarMenuButton)
 * - SettingsDialog renders/mounts SettingsForm based on the same flag
 *
 * SettingsForm itself is stubbed here (it has a dedicated suite).
 */

import { store } from '@/app/store'
import { setOpenDialog } from '@/features/settings/settingsSlice'
import { Sidebar, SidebarProvider } from '@/shared/animate-ui/radix/sidebar'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/settings/dialog/SettingsForm', () => ({
  default: () => <div data-testid="settings-form" />,
}))

import OpenSettingsDialogButton from '@/features/settings/dialog/OpenSettingsDialogButton'
import SettingsDialog from '@/features/settings/dialog/SettingsDialog'

describe('OpenSettingsDialogButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.dispatch(setOpenDialog(false))
  })

  it('opens the settings dialog on click', async () => {
    // SidebarMenuButton requires the full Sidebar tree (MotionHighlight +
    // useSidebar contexts), matching how PageLayoutShell mounts it.
    const { user } = renderWithProviders(
      <SidebarProvider>
        <Sidebar>
          <OpenSettingsDialogButton />
        </Sidebar>
      </SidebarProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'settings.title' }))

    expect(store.getState().settings.dialogOpen).toBe(true)
  })
})

describe('SettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.dispatch(setOpenDialog(false))
    mockInvoke.mockResolvedValue(undefined)
  })

  it('renders nothing until dialogOpen is true', () => {
    renderWithProviders(<SettingsDialog />)

    expect(screen.queryByText('settings.dialog_title')).toBeNull()
    expect(screen.queryByTestId('settings-form')).toBeNull()
  })

  it('shows the title and mounts the form when open', () => {
    store.dispatch(setOpenDialog(true))
    renderWithProviders(<SettingsDialog />)

    expect(screen.getByText('settings.dialog_title')).toBeInTheDocument()
    expect(screen.getByTestId('settings-form')).toBeInTheDocument()
  })

  it('closing via Escape dispatches dialogOpen false', () => {
    store.dispatch(setOpenDialog(true))
    renderWithProviders(<SettingsDialog />)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(store.getState().settings.dialogOpen).toBe(false)
  })
})
