import { formatDuration } from '@/features/rotation/lib/format'
import RotationContent from '@/pages/rotation'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The hook (invoke/rotate flows) is covered by useRotation.test.tsx; the
// form is its presentation layer, so the hook is stubbed here.
vi.mock('@/features/rotation/hooks/useRotation', () => ({
  useRotation: vi.fn(),
}))

import { useRotation } from '@/features/rotation/hooks/useRotation'

function createMockUseRotation(
  overrides: Partial<ReturnType<typeof useRotation>> = {},
): ReturnType<typeof useRotation> {
  return {
    inputPath: null,
    outputPath: null,
    angle: 90,
    mode: 'copy',
    status: 'idle',
    progress: null,
    elapsedSec: 0,
    remainingSec: null,
    setAngle: vi.fn(),
    setMode: vi.fn(),
    handleBrowse: vi.fn(),
    handleChooseOutput: vi.fn(),
    handleRotate: vi.fn(),
    handleReveal: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useRotation>
}

describe('RotationContent (page + RotationForm wiring)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useRotation).mockReturnValue(createMockUseRotation())
  })

  it('renders the page header and sets the document title', () => {
    renderWithProviders(<RotationContent />, { route: '/rotation' })

    expect(screen.getByText('rotation.title')).toBeInTheDocument()
    expect(screen.getByText('rotation.description')).toBeInTheDocument()
    expect(document.title).toBe('rotation.title - app.title')
  })

  it('shows the empty-state hints and disables rotate without files', async () => {
    const { user } = renderWithProviders(<RotationContent />, {
      route: '/rotation',
    })

    expect(screen.getByText('rotation.noFileSelected')).toBeInTheDocument()
    expect(screen.getByText('rotation.noOutputSelected')).toBeInTheDocument()

    const rotate = screen.getByText('rotation.rotate').closest('button')!
    expect(rotate).toBeDisabled()
    await user.click(rotate)
    expect(
      vi.mocked(useRotation).mock.results[0]!.value.handleRotate,
    ).not.toHaveBeenCalled()
  })

  it('enables rotate once paths exist and forwards the click', async () => {
    vi.mocked(useRotation).mockReturnValue(
      createMockUseRotation({
        inputPath: '/in/movie.mp4',
        outputPath: '/out/movie_rotated.mp4',
      }),
    )

    const { user } = renderWithProviders(<RotationContent />, {
      route: '/rotation',
    })

    const rotate = screen.getByText('rotation.rotate').closest('button')!
    expect(rotate).toBeEnabled()
    await user.click(rotate)
    expect(
      vi.mocked(useRotation).mock.results[0]!.value.handleRotate,
    ).toHaveBeenCalledOnce()
  })

  it('selecting an angle radio calls setAngle with the numeric value', async () => {
    const setAngle = vi.fn()
    vi.mocked(useRotation).mockReturnValue(createMockUseRotation({ setAngle }))

    const { user } = renderWithProviders(<RotationContent />, {
      route: '/rotation',
    })

    // Label text includes the hint span, so match on the prefix only.
    await user.click(screen.getByLabelText(/rotation\.angle\.left90/))
    expect(setAngle).toHaveBeenCalledWith(270)
  })

  it('selecting the reencode mode radio calls setMode', async () => {
    const setMode = vi.fn()
    vi.mocked(useRotation).mockReturnValue(createMockUseRotation({ setMode }))

    const { user } = renderWithProviders(<RotationContent />, {
      route: '/rotation',
    })

    // Both the radio and its nested tooltip trigger can resolve to the
    // label text; the radio is the first labelled element.
    const [reencodeRadio] = screen.getAllByLabelText(/rotation\.mode\.accurate/)
    await user.click(reencodeRadio)
    expect(setMode).toHaveBeenCalledWith('reencode')
  })

  it('renders progress (elapsed/remaining) only for reencode mode', () => {
    vi.mocked(useRotation).mockReturnValue(
      createMockUseRotation({
        inputPath: '/in/movie.mp4',
        outputPath: '/out/movie_rotated.mp4',
        mode: 'reencode',
        status: 'rotating',
        progress: { progress: 42, currentTimeSec: 0, totalDurationSec: 0 },
        elapsedSec: 12,
        remainingSec: 125,
      }),
    )

    renderWithProviders(<RotationContent />, { route: '/rotation' })

    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText(/rotation\.elapsed/)).toHaveTextContent('0:12')
    expect(screen.getByText(/rotation\.remaining/)).toHaveTextContent('2:05')
    expect(screen.getByText('rotation.rotating')).toBeInTheDocument()
  })

  it('hides the progress bar in copy mode even while rotating', () => {
    vi.mocked(useRotation).mockReturnValue(
      createMockUseRotation({
        mode: 'copy',
        status: 'rotating',
        progress: { progress: 42, currentTimeSec: 0, totalDurationSec: 0 },
      }),
    )

    renderWithProviders(<RotationContent />, { route: '/rotation' })

    expect(screen.queryByText('42%')).not.toBeInTheDocument()
  })
})

describe('formatDuration (rotation)', () => {
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
