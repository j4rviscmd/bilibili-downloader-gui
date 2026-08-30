import { formatDuration } from '@/features/resolution/lib/format'
import { RESOLUTION_HEIGHT_PRESETS } from '@/features/resolution/lib/resolution'
import ResolutionContent from '@/pages/resolution'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The hook (probe/convert flows) is covered by its own hook tests; the form
// is its presentation layer, so the hook is stubbed here.
vi.mock('@/features/resolution/hooks/useResolution', () => ({
  useResolution: vi.fn(),
}))

import { useResolution } from '@/features/resolution/hooks/useResolution'

function createMockUseResolution(
  overrides: Partial<ReturnType<typeof useResolution>> = {},
): ReturnType<typeof useResolution> {
  return {
    inputPath: null,
    outputPath: null,
    targetHeight: 720,
    isCustomHeight: false,
    enabledResolutions: [480, 720],
    inputResolution: null,
    status: 'idle',
    progress: null,
    elapsedSec: 0,
    remainingSec: null,
    setTargetHeight: vi.fn(),
    setIsCustomHeight: vi.fn(),
    handleBrowse: vi.fn(),
    handleChooseOutput: vi.fn(),
    handleConvert: vi.fn(),
    handleReveal: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useResolution>
}

describe('ResolutionContent (page + ResolutionForm wiring)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useResolution).mockReturnValue(createMockUseResolution())
  })

  it('renders the page header and sets the document title', () => {
    renderWithProviders(<ResolutionContent />, { route: '/resolution' })

    expect(screen.getByText('resolution.title')).toBeInTheDocument()
    expect(screen.getByText('resolution.description')).toBeInTheDocument()
    expect(document.title).toBe('resolution.title - app.title')
  })

  it('renders one radio per preset plus the custom option', () => {
    renderWithProviders(<ResolutionContent />, { route: '/resolution' })

    for (const height of RESOLUTION_HEIGHT_PRESETS) {
      expect(screen.getByText(`${height}p`)).toBeInTheDocument()
    }
    expect(screen.getByText('resolution.resolution.custom')).toBeInTheDocument()
  })

  it('shows the empty-state hints and disables convert without files', async () => {
    const { user } = renderWithProviders(<ResolutionContent />, {
      route: '/resolution',
    })

    expect(screen.getByText('resolution.noFileSelected')).toBeInTheDocument()
    expect(screen.getByText('resolution.noOutputSelected')).toBeInTheDocument()

    const convert = screen.getByText('resolution.convert').closest('button')!
    expect(convert).toBeDisabled()
    await user.click(convert)
    expect(
      vi.mocked(useResolution).mock.results[0]!.value.handleConvert,
    ).not.toHaveBeenCalled()
  })

  it('selecting a preset calls setTargetHeight and clears custom mode', async () => {
    const setTargetHeight = vi.fn()
    const setIsCustomHeight = vi.fn()
    vi.mocked(useResolution).mockReturnValue(
      createMockUseResolution({
        enabledResolutions: [360, 480, 720],
        isCustomHeight: true,
        setTargetHeight,
        setIsCustomHeight,
      }),
    )

    const { user } = renderWithProviders(<ResolutionContent />, {
      route: '/resolution',
    })

    await user.click(screen.getByLabelText('480p'))
    expect(setIsCustomHeight).toHaveBeenCalledWith(false)
    expect(setTargetHeight).toHaveBeenCalledWith(480)
  })

  it('selecting custom shows the height input and typing updates setTargetHeight', async () => {
    const setTargetHeight = vi.fn()
    const setIsCustomHeight = vi.fn()
    vi.mocked(useResolution).mockReturnValue(
      createMockUseResolution({ setTargetHeight, setIsCustomHeight }),
    )

    const { user } = renderWithProviders(<ResolutionContent />, {
      route: '/resolution',
    })

    await user.click(screen.getByLabelText('resolution.resolution.custom'))
    expect(setIsCustomHeight).toHaveBeenCalledWith(true)

    vi.mocked(useResolution).mockReturnValue(
      createMockUseResolution({ isCustomHeight: true, setTargetHeight }),
    )
    renderWithProviders(<ResolutionContent />, { route: '/resolution' })

    const input = screen.getByLabelText(
      'resolution.resolution.customHeightLabel',
    ) as HTMLInputElement
    expect(input).toBeInTheDocument()
    await user.click(input)
    await user.keyboard('1')
    // Controlled input starts at targetHeight 720, so typing appends.
    expect(setTargetHeight).toHaveBeenCalledWith(7201)
  })

  it('shows the source resolution line when the probe result exists', () => {
    vi.mocked(useResolution).mockReturnValue(
      createMockUseResolution({
        // Note: keeping every preset enabled here. With a known input
        // resolution AND a disabled preset, ResolutionOption renders a
        // Tooltip outside any TooltipProvider (ResolutionForm's resolution
        // RadioGroup is not wrapped, unlike the audio bitrate group) and
        // Radix throws — a production bug, reported separately.
        enabledResolutions: [...RESOLUTION_HEIGHT_PRESETS],
        inputResolution: { width: 1920, height: 1080 },
      }),
    )

    renderWithProviders(<ResolutionContent />, { route: '/resolution' })

    // Identity t renders the key with the interpolated width/height.
    expect(screen.getByText(/resolution\.sourceResolution/)).toBeInTheDocument()
  })

  it('renders progress with elapsed/remaining while converting', () => {
    vi.mocked(useResolution).mockReturnValue(
      createMockUseResolution({
        status: 'converting',
        progress: { progress: 42, currentTimeSec: 0, totalDurationSec: 0 },
        elapsedSec: 12,
        remainingSec: 125,
      }),
    )

    renderWithProviders(<ResolutionContent />, { route: '/resolution' })

    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText(/resolution\.elapsed/)).toHaveTextContent('0:12')
    expect(screen.getByText(/resolution\.remaining/)).toHaveTextContent('2:05')
    expect(screen.getByText('resolution.converting')).toBeInTheDocument()
  })
})

describe('formatDuration (resolution)', () => {
  it.each([
    [0, '0:00'],
    [12.7, '0:12'],
    [83, '1:23'],
    [6330, '1:45:30'],
  ])('formats %p seconds as %p', (input, expected) => {
    expect(formatDuration(input)).toBe(expected)
  })
})
