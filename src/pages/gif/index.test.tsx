import { formatDuration } from '@/features/gif/lib/format'
import GifContent from '@/pages/gif'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The hook (invoke/generation flows) is covered by useGif.test.tsx; the
// form is its presentation layer, so the hook is stubbed here.
vi.mock('@/features/gif/hooks/useGif', () => ({
  useGif: vi.fn(),
}))

import { useGif } from '@/features/gif/hooks/useGif'

function createMockUseGif(
  overrides: Partial<ReturnType<typeof useGif>> = {},
): ReturnType<typeof useGif> {
  return {
    inputPath: null,
    outputPath: null,
    start: '',
    end: '',
    format: 'gif',
    widthPreset: '480',
    fps: '15',
    sourceWidth: null,
    status: 'idle',
    rangeError: null,
    progress: null,
    elapsedSec: 0,
    remainingSec: null,
    setStart: vi.fn(),
    setEnd: vi.fn(),
    setFormat: vi.fn(),
    setWidthPreset: vi.fn(),
    setFps: vi.fn(),
    handleBrowse: vi.fn(),
    handleChooseOutput: vi.fn(),
    handleGenerate: vi.fn(),
    handleReveal: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useGif>
}

describe('GifContent (page + GifForm wiring)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useGif).mockReturnValue(createMockUseGif())
  })

  it('renders the page header and sets the document title', () => {
    renderWithProviders(<GifContent />, { route: '/gif' })

    expect(screen.getByText('gif.title')).toBeInTheDocument()
    expect(screen.getByText('gif.description')).toBeInTheDocument()
    expect(document.title).toBe('gif.title - app.title')
  })

  it('shows the empty-state hints and disables generate without files', async () => {
    const { user } = renderWithProviders(<GifContent />, { route: '/gif' })

    expect(screen.getByText('gif.noFileSelected')).toBeInTheDocument()
    expect(screen.getByText('gif.noOutputSelected')).toBeInTheDocument()

    const generate = screen.getByText('gif.generate').closest('button')!
    expect(generate).toBeDisabled()
    await user.click(generate)
    expect(
      vi.mocked(useGif).mock.results[0]!.value.handleGenerate,
    ).not.toHaveBeenCalled()
  })

  it('enables generate once paths exist and forwards the click', async () => {
    vi.mocked(useGif).mockReturnValue(
      createMockUseGif({
        inputPath: '/in/movie.mp4',
        outputPath: '/out/movie_clip.gif',
      }),
    )

    const { user } = renderWithProviders(<GifContent />, { route: '/gif' })

    const generate = screen.getByText('gif.generate').closest('button')!
    expect(generate).toBeEnabled()
    await user.click(generate)
    expect(
      vi.mocked(useGif).mock.results[0]!.value.handleGenerate,
    ).toHaveBeenCalledOnce()
  })

  it('typing start/end times forwards raw strings to the setters', async () => {
    const setStart = vi.fn()
    const setEnd = vi.fn()
    vi.mocked(useGif).mockReturnValue(createMockUseGif({ setStart, setEnd }))

    const { user } = renderWithProviders(<GifContent />, { route: '/gif' })

    await user.click(screen.getByLabelText('gif.startTime'))
    await user.keyboard('1')
    expect(setStart).toHaveBeenCalledWith('1')

    await user.click(screen.getByLabelText('gif.endTime'))
    await user.keyboard('5')
    expect(setEnd).toHaveBeenCalledWith('5')
  })

  it('renders the mapped range-error key from the hook', () => {
    vi.mocked(useGif).mockReturnValue(
      createMockUseGif({ rangeError: 'end_before_start' }),
    )

    renderWithProviders(<GifContent />, { route: '/gif' })

    expect(screen.getByText('gif.error.end_before_start')).toBeInTheDocument()
  })

  it('selecting the webm format radio calls setFormat', async () => {
    const setFormat = vi.fn()
    vi.mocked(useGif).mockReturnValue(createMockUseGif({ setFormat }))

    const { user } = renderWithProviders(<GifContent />, { route: '/gif' })

    // Label text includes badge + tooltip aria text; match on the prefix.
    const [webmRadio] = screen.getAllByLabelText(/gif\.format\.webm/)
    await user.click(webmRadio)
    expect(setFormat).toHaveBeenCalledWith('webm')
  })

  it('selecting a width preset calls setWidthPreset', async () => {
    const setWidthPreset = vi.fn()
    vi.mocked(useGif).mockReturnValue(createMockUseGif({ setWidthPreset }))

    const { user } = renderWithProviders(<GifContent />, { route: '/gif' })

    await user.click(screen.getByLabelText('640px'))
    expect(setWidthPreset).toHaveBeenCalledWith('640')
  })

  it('appends the probed source width to the Original label', () => {
    vi.mocked(useGif).mockReturnValue(createMockUseGif({ sourceWidth: 1920 }))

    renderWithProviders(<GifContent />, { route: '/gif' })

    expect(screen.getByText('gif.size.original (1920px)')).toBeInTheDocument()
  })

  it('renders progress with elapsed/remaining while generating', () => {
    vi.mocked(useGif).mockReturnValue(
      createMockUseGif({
        status: 'generating',
        progress: { progress: 42, currentTimeSec: 0, totalDurationSec: 0 },
        elapsedSec: 12,
        remainingSec: 125,
      }),
    )

    renderWithProviders(<GifContent />, { route: '/gif' })

    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText(/gif\.elapsed/)).toHaveTextContent('0:12')
    expect(screen.getByText(/gif\.remaining/)).toHaveTextContent('2:05')
    expect(screen.getByText('gif.generating')).toBeInTheDocument()
  })

  it('renders progress without a remaining estimate when unavailable', () => {
    vi.mocked(useGif).mockReturnValue(
      createMockUseGif({
        status: 'generating',
        progress: { progress: 1, currentTimeSec: 0, totalDurationSec: 0 },
        elapsedSec: 3,
        remainingSec: null,
      }),
    )

    renderWithProviders(<GifContent />, { route: '/gif' })

    expect(screen.getByText('1%')).toBeInTheDocument()
    expect(screen.getByText(/gif\.elapsed/)).toHaveTextContent('0:03')
    expect(screen.queryByText(/gif\.remaining/)).not.toBeInTheDocument()
  })

  it('renders the empty-start range error key from the hook', () => {
    vi.mocked(useGif).mockReturnValue(
      createMockUseGif({ rangeError: 'empty_start' }),
    )

    renderWithProviders(<GifContent />, { route: '/gif' })

    expect(screen.getByText('gif.error.empty_start')).toBeInTheDocument()
  })
})

describe('formatDuration (gif)', () => {
  it.each([
    [0, '0:00'],
    [12.5, '0:12'],
    [125, '2:05'],
    [3661, '1:01:01'],
    [-90, '0:00'],
  ])('formats %p seconds as %p', (input, expected) => {
    expect(formatDuration(input)).toBe(expected)
  })
})
