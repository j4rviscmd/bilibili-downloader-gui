import { SplashScreen } from '@/features/splash'
import {
  emitTauriEvent,
  mockInvoke,
  renderWithProviders,
} from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

  // Theme tests rewrite the URL search param; restore a clean URL after each.
  afterEach(() => {
    window.history.pushState({}, '', '/')
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
    // Without theme/accent params the scene runs light pink (app defaults).
    expect(vi.mocked(useThreeScene)).toHaveBeenCalledWith(
      expect.anything(),
      true,
      false,
      'pink',
    )
  })

  it('renders dark-mode styling and passes dark to the scene when theme=dark', () => {
    window.history.pushState({}, '', '/splashscreen?theme=dark')

    renderWithProviders(<SplashScreen />)

    // The scene receives the dark flag (palette: dark backdrop + brightened
    // particle shades).
    expect(vi.mocked(useThreeScene)).toHaveBeenCalledWith(
      expect.anything(),
      true,
      true,
      'pink',
    )
    // Background and title switch to the dark variants; the glow keeps the
    // stronger dark opacity with the pink accent rgb.
    expect(document.querySelector('.dark\\:bg-\\[\\#0f172a\\]')).not.toBeNull()
    const title = screen.getByRole('heading', { level: 1 })
    expect(title.style.color).toBe('#e5e7ebee')
    expect(title.style.textShadow).toBe('0 0 40px rgba(251,114,153,0.35)')
  })

  it('renders pink DOM colors by default and passes pink to the scene', () => {
    renderWithProviders(<SplashScreen />)

    expect(vi.mocked(useThreeScene)).toHaveBeenCalledWith(
      expect.anything(),
      true,
      false,
      'pink',
    )
    const title = screen.getByRole('heading', { level: 1 })
    expect(title.querySelector('span')!.style.color).toBe('#fb7299')
    expect(title.style.textShadow).toBe('0 0 40px rgba(251,114,153,0.2)')
  })

  it('renders blue DOM colors and passes blue to the scene when accent=blue', () => {
    window.history.pushState({}, '', '/splashscreen?accent=blue')

    renderWithProviders(<SplashScreen />)

    expect(vi.mocked(useThreeScene)).toHaveBeenCalledWith(
      expect.anything(),
      true,
      false,
      'blue',
    )
    const title = screen.getByRole('heading', { level: 1 })
    expect(title.querySelector('span')!.style.color).toBe('#00A1D6')
    expect(title.style.textShadow).toBe('0 0 40px rgba(0,161,214,0.2)')
  })

  it('shows the ffmpeg determinate progress bar during ffmpeg install', async () => {
    renderWithProviders(<SplashScreen />)

    emitTauriEvent('init_step', { labelKey: 'init.installing_ffmpeg' })
    emitTauriEvent('progress', { downloadId: 'ffmpeg-install', percentage: 42 })

    expect(
      await screen.findByText('init.installing_ffmpeg'),
    ).toBeInTheDocument()
    // The determinate bar's fill width and color are driven by the
    // progress percentage and the accent.
    const fill = screen.getByTestId('splash-progress-fill')
    expect(fill).toHaveStyle({ width: '42%', backgroundColor: '#fb7299' })
  })

  it('ignores progress events for other downloads', async () => {
    renderWithProviders(<SplashScreen />)

    emitTauriEvent('init_step', { labelKey: 'init.installing_ffmpeg' })
    emitTauriEvent('progress', { downloadId: 'some-video', percentage: 42 })

    await screen.findByText('init.installing_ffmpeg')
    expect(screen.queryByTestId('splash-progress-fill')).toBeNull()
  })
})
