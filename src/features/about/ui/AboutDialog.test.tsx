/**
 * About dialog suite.
 *
 * Covers the settings-screen trigger (AboutDialog), the shared content
 * (AboutDialogContent: get_app_info fetch, OS formatting, copy) and the
 * macOS menu-bar entry (MenuAboutDialog, driven by the in-memory Tauri
 * event bus from src/test/setup.ts).
 */

import type { AppInfo } from '@/features/about'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen, waitFor } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { toast } from '@/shared/ui/toast'
import { emitTauriEvent } from '@/test/tauriEvents'

import { AboutDialog } from './AboutDialog'
import { AboutDialogContent } from './AboutDialogContent'
import { MenuAboutDialog } from './MenuAboutDialog'

const toastSuccess = toast.success as unknown as Mock

const appInfo: AppInfo = {
  app_name: 'Bilibili Downloader',
  app_version: '1.2.3',
  tauri_version: '2.7.0',
  os_name: 'macos',
  os_version: '15.0',
  arch: 'aarch64',
}

/** happy-dom has no clipboard implementation. */
const writeText = vi.fn().mockResolvedValue(undefined)

describe('AboutDialog (settings trigger)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_app_info') return Promise.resolve(appInfo)
      return Promise.resolve(undefined)
    })
  })

  it('opens the dialog on click and shows the version row', async () => {
    const { user } = renderWithProviders(<AboutDialog />)

    await user.click(screen.getByRole('button', { name: 'about.button' }))

    expect(await screen.findByText('v1.2.3')).toBeInTheDocument()
    expect(mockInvoke).toHaveBeenCalledWith('get_app_info')
  })
})

describe('AboutDialogContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders placeholders before the info resolves', () => {
    mockInvoke.mockResolvedValue(undefined)
    renderWithProviders(<AboutDialogContent open onOpenChange={vi.fn()} />)

    expect(screen.getByText('about.app_name')).toBeInTheDocument()
    // All four info rows fall back to '-' while info is null
    expect(screen.getAllByText('-')).toHaveLength(4)
  })

  it('formats the OS line per platform', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_app_info') {
        return Promise.resolve({
          ...appInfo,
          os_name: 'windows',
          os_version: '10.0.22631',
        })
      }
      return Promise.resolve(undefined)
    })
    renderWithProviders(<AboutDialogContent open onOpenChange={vi.fn()} />)

    // Build >= 22000 -> Windows 11
    expect(
      await screen.findByText('Windows 11 (build 22631)'),
    ).toBeInTheDocument()
  })

  it('copies the environment info as a markdown list', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_app_info') return Promise.resolve(appInfo)
      return Promise.resolve(undefined)
    })
    const { user } = renderWithProviders(
      <AboutDialogContent open onOpenChange={vi.fn()} />,
    )

    // Copy stays disabled until get_app_info resolves; wait for the version.
    // The clipboard stub must be installed AFTER render — happy-dom installs
    // its own navigator.clipboard while the component tree loads.
    await screen.findByText('v1.2.3')
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    await user.click(screen.getByRole('button', { name: 'about.copy' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const text = writeText.mock.calls[0][0] as string
    expect(text).toContain('- App: about.app_name v1.2.3')
    expect(text).toContain('- OS: macOS 15.0')
    expect(text).toContain('- Architecture: aarch64')
    expect(text).toContain('- Tauri: 2.7.0')
    expect(toastSuccess).toHaveBeenCalledWith('about.copied')
  })

  it('opens the repository link via openUrl', async () => {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_app_info') return Promise.resolve(appInfo)
      return Promise.resolve(undefined)
    })
    const { user } = renderWithProviders(
      <AboutDialogContent open onOpenChange={vi.fn()} />,
    )

    await screen.findByText('v1.2.3')
    // The repo entry is a link-styled Button, not an anchor
    await user.click(
      screen.getByRole('button', {
        name: 'github.com/j4rviscmd/bilibili-downloader-gui',
      }),
    )

    expect(openUrl).toHaveBeenCalledWith(
      'https://github.com/j4rviscmd/bilibili-downloader-gui',
    )
  })
})

describe('MenuAboutDialog (macOS menu-bar entry)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_app_info') return Promise.resolve(appInfo)
      return Promise.resolve(undefined)
    })
  })

  it('opens on the menu:about event and shows the version row', async () => {
    renderWithProviders(<MenuAboutDialog />)

    emitTauriEvent('menu:about', undefined)

    expect(await screen.findByText('v1.2.3')).toBeInTheDocument()
  })

  it('does not open without the event', () => {
    renderWithProviders(<MenuAboutDialog />)

    expect(screen.queryByText('v1.2.3')).toBeNull()
  })
})
