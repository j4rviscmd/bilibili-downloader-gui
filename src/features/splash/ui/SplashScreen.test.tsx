import { SplashScreen } from '@/features/splash'
import {
  emitTauriEvent,
  mockInvoke,
  renderWithProviders,
} from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The lifecycle hook is covered by useSplashLifecycle.test.tsx; here it is
// stubbed so each render locks one phase of the visual state machine.
vi.mock('@/features/splash/hooks/useSplashLifecycle', () => ({
  useSplashLifecycle: vi.fn(),
}))
// Three.js scene setup needs a WebGL context happy-dom cannot provide.
vi.mock('@/features/splash/hooks/useThreeScene', () => ({
  useThreeScene: vi.fn(),
}))

import { useSplashLifecycle } from '@/features/splash/hooks/useSplashLifecycle'
import { useThreeScene } from '@/features/splash/hooks/useThreeScene'

type SplashLifecycle = ReturnType<typeof useSplashLifecycle>

function mockLifecycle(overrides: Partial<SplashLifecycle>) {
  const value: SplashLifecycle = {
    phase: 'active',
    onFadeComplete: vi.fn(),
    skipMode: false,
    ...overrides,
  }
  vi.mocked(useSplashLifecycle).mockReturnValue(value)
  return value
}

describe('SplashScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // SplashScreen invokes show_splash and chains .catch on the result; the
    // bare vi.fn() from setup returns undefined, so make it thenable.
    mockInvoke.mockResolvedValue(undefined)
    mockLifecycle({})
  })

  it('renders nothing once the fade phase is done', () => {
    mockLifecycle({ phase: 'done' })

    const { container } = renderWithProviders(<SplashScreen />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders a blank background while settings are still loading', () => {
    mockLifecycle({ skipMode: null })

    renderWithProviders(<SplashScreen />)

    // No title or step label until skip mode is resolved.
    expect(screen.getByTestId('splash-screen')).toBeInTheDocument()
    expect(screen.queryByText('Bilibili')).not.toBeInTheDocument()
  })

  it('renders the CSS spinner and step label in skip mode', async () => {
    mockLifecycle({ skipMode: true })

    renderWithProviders(<SplashScreen />)

    expect(screen.getByTestId('splash-screen')).toBeInTheDocument()
    // No step label before any init_step event.
    expect(screen.queryByText('init.checking_ffmpeg')).not.toBeInTheDocument()

    emitTauriEvent('init_step', { labelKey: 'init.checking_ffmpeg' })
    expect(await screen.findByText('init.checking_ffmpeg')).toBeInTheDocument()
  })

  it('renders the title in full animation mode and reveals the window', () => {
    renderWithProviders(<SplashScreen />)

    // show_splash is invoked after mount to reveal the hidden window.
    expect(mockInvoke).toHaveBeenCalledWith('show_splash')
    expect(screen.getByText('Bilibili')).toBeInTheDocument()
    expect(screen.getByText('Downloader')).toBeInTheDocument()
    // Full mode mounts the Three.js canvas and starts the scene.
    expect(vi.mocked(useThreeScene)).toHaveBeenCalled()
  })

  it('shows the ffmpeg determinate progress bar during ffmpeg install', async () => {
    renderWithProviders(<SplashScreen />)

    emitTauriEvent('init_step', { labelKey: 'init.installing_ffmpeg' })
    emitTauriEvent('progress', { downloadId: 'ffmpeg-install', percentage: 42 })

    expect(
      await screen.findByText('init.installing_ffmpeg'),
    ).toBeInTheDocument()
    // The determinate bar's fill width is driven by the progress percentage.
    const fill = document.querySelector(
      '.bg-\\[\\#00A1D6\\]',
    ) as HTMLElement | null
    expect(fill).not.toBeNull()
    expect(fill).toHaveStyle({ width: '42%' })
  })

  it('ignores progress events for other downloads', async () => {
    renderWithProviders(<SplashScreen />)

    emitTauriEvent('init_step', { labelKey: 'init.installing_ffmpeg' })
    emitTauriEvent('progress', { downloadId: 'some-video', percentage: 42 })

    await screen.findByText('init.installing_ffmpeg')
    expect(document.querySelector('.bg-\\[\\#00A1D6\\]')).toBeNull()
  })
})
