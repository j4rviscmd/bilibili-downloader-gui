import { formatDuration } from '@/features/audio/lib/format'
import AudioContent from '@/pages/audio'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The hook (invoke/probe/extract flows) is covered by useAudio.test.tsx; the
// form is its presentation layer, so the hook is stubbed here.
vi.mock('@/features/audio/hooks/useAudio', () => ({
  useAudio: vi.fn(),
}))

import { useAudio } from '@/features/audio/hooks/useAudio'

function createMockUseAudio(
  overrides: Partial<ReturnType<typeof useAudio>> = {},
): ReturnType<typeof useAudio> {
  return {
    inputPath: null,
    outputPath: null,
    format: 'mp3',
    bitrateKbps: 192,
    enabledBitrates: [128, 192, 256, 320],
    inputBitrate: null,
    status: 'idle',
    progress: null,
    elapsedSec: 0,
    remainingSec: null,
    setFormat: vi.fn(),
    setBitrateKbps: vi.fn(),
    handleBrowse: vi.fn(),
    handleChooseOutput: vi.fn(),
    handleExtract: vi.fn(),
    handleReveal: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useAudio>
}

describe('AudioContent (page + AudioForm wiring)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAudio).mockReturnValue(createMockUseAudio())
  })

  it('renders the page header and sets the document title', () => {
    renderWithProviders(<AudioContent />, { route: '/audio' })

    expect(screen.getByText('audio.title')).toBeInTheDocument()
    expect(screen.getByText('audio.description')).toBeInTheDocument()
    expect(document.title).toBe('audio.title - app.title')
  })

  it('shows the empty-state hints and disables extract without files', async () => {
    const { user } = renderWithProviders(<AudioContent />, {
      route: '/audio',
    })

    expect(screen.getByText('audio.noFileSelected')).toBeInTheDocument()
    expect(screen.getByText('audio.noOutputSelected')).toBeInTheDocument()

    const extract = screen.getByText('audio.extract').closest('button')!
    expect(extract).toBeDisabled()
    await user.click(extract)
    expect(
      vi.mocked(useAudio).mock.results[0]!.value.handleExtract,
    ).not.toHaveBeenCalled()
  })

  it('enables extract once input and output are chosen and forwards the click', async () => {
    vi.mocked(useAudio).mockReturnValue(
      createMockUseAudio({
        inputPath: '/in/movie.mp4',
        outputPath: '/out/movie_audio.mp3',
      }),
    )

    const { user } = renderWithProviders(<AudioContent />, {
      route: '/audio',
    })

    expect(screen.getByText('/in/movie.mp4')).toBeInTheDocument()
    expect(screen.getByText('/out/movie_audio.mp3')).toBeInTheDocument()

    const extract = screen.getByText('audio.extract').closest('button')!
    expect(extract).toBeEnabled()
    await user.click(extract)
    expect(
      vi.mocked(useAudio).mock.results[0]!.value.handleExtract,
    ).toHaveBeenCalledOnce()
  })

  it('selecting a format radio calls setFormat with the value', async () => {
    const setFormat = vi.fn()
    vi.mocked(useAudio).mockReturnValue(createMockUseAudio({ setFormat }))

    const { user } = renderWithProviders(<AudioContent />, {
      route: '/audio',
    })

    await user.click(screen.getByLabelText(/audio\.format\.m4a/))
    expect(setFormat).toHaveBeenCalledWith('m4a')
  })

  it('selecting a bitrate radio calls setBitrateKbps with the number', async () => {
    const setBitrateKbps = vi.fn()
    vi.mocked(useAudio).mockReturnValue(createMockUseAudio({ setBitrateKbps }))

    const { user } = renderWithProviders(<AudioContent />, {
      route: '/audio',
    })

    await user.click(screen.getByText('320 kbps'))
    expect(setBitrateKbps).toHaveBeenCalledWith(320)
  })

  it('renders the progress bar with elapsed/remaining once extracting', () => {
    vi.mocked(useAudio).mockReturnValue(
      createMockUseAudio({
        status: 'extracting',
        progress: { progress: 42, currentTimeSec: 0, totalDurationSec: 0 },
        elapsedSec: 12,
        remainingSec: 125,
      }),
    )

    renderWithProviders(<AudioContent />, { route: '/audio' })

    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText(/audio\.elapsed/)).toHaveTextContent('0:12')
    expect(screen.getByText(/audio\.remaining/)).toHaveTextContent('2:05')
    expect(screen.getByText('audio.extracting')).toBeInTheDocument()
  })
})

describe('formatDuration (audio)', () => {
  it.each([
    [0, '0:00'],
    [12.5, '0:12'],
    [125, '2:05'],
    [3661, '1:01:01'],
    // Negative input is clamped to zero so a transient bad value never
    // renders as "-1:30".
    [-90, '0:00'],
  ])('formats %p seconds as %p', (input, expected) => {
    expect(formatDuration(input)).toBe(expected)
  })

  it('rounds fractional seconds down', () => {
    expect(formatDuration(59.9)).toBe('0:59')
  })
})
