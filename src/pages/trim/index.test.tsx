import { formatDuration } from '@/features/trim/lib/format'
import TrimContent from '@/pages/trim'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The hook (invoke/trim flows) is covered by useTrim.test.tsx; the form is
// its presentation layer, so the hook is stubbed here.
vi.mock('@/features/trim/hooks/useTrim', () => ({
  useTrim: vi.fn(),
}))

import { useTrim } from '@/features/trim/hooks/useTrim'

function createMockUseTrim(
  overrides: Partial<ReturnType<typeof useTrim>> = {},
): ReturnType<typeof useTrim> {
  return {
    inputPath: null,
    outputPath: null,
    start: '',
    end: '',
    mode: 'copy',
    status: 'idle',
    rangeError: null,
    progress: null,
    elapsedSec: 0,
    remainingSec: null,
    setStart: vi.fn(),
    setEnd: vi.fn(),
    setMode: vi.fn(),
    handleBrowse: vi.fn(),
    handleChooseOutput: vi.fn(),
    handleTrim: vi.fn(),
    handleReveal: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useTrim>
}

describe('TrimContent (page + TrimForm wiring)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useTrim).mockReturnValue(createMockUseTrim())
  })

  it('renders the page header and sets the document title', () => {
    renderWithProviders(<TrimContent />, { route: '/trim' })

    expect(screen.getByText('trim.title')).toBeInTheDocument()
    expect(screen.getByText('trim.description')).toBeInTheDocument()
    expect(document.title).toBe('trim.title - app.title')
  })

  it('shows the empty-state hints and disables trim without files', async () => {
    const { user } = renderWithProviders(<TrimContent />, { route: '/trim' })

    expect(screen.getByText('trim.noFileSelected')).toBeInTheDocument()
    expect(screen.getByText('trim.noOutputSelected')).toBeInTheDocument()

    const trim = screen.getByText('trim.trim').closest('button')!
    expect(trim).toBeDisabled()
    await user.click(trim)
    expect(
      vi.mocked(useTrim).mock.results[0]!.value.handleTrim,
    ).not.toHaveBeenCalled()
  })

  it('enables trim once paths exist and forwards the click', async () => {
    vi.mocked(useTrim).mockReturnValue(
      createMockUseTrim({
        inputPath: '/in/movie.mp4',
        outputPath: '/out/movie_trimmed.mp4',
      }),
    )

    const { user } = renderWithProviders(<TrimContent />, { route: '/trim' })

    const trim = screen.getByText('trim.trim').closest('button')!
    expect(trim).toBeEnabled()
    await user.click(trim)
    expect(
      vi.mocked(useTrim).mock.results[0]!.value.handleTrim,
    ).toHaveBeenCalledOnce()
  })

  it('typing start/end times forwards raw strings to the setters', async () => {
    const setStart = vi.fn()
    const setEnd = vi.fn()
    vi.mocked(useTrim).mockReturnValue(createMockUseTrim({ setStart, setEnd }))

    const { user } = renderWithProviders(<TrimContent />, { route: '/trim' })

    await user.click(screen.getByLabelText('trim.startTime'))
    await user.keyboard('1')
    expect(setStart).toHaveBeenCalledWith('1')

    await user.click(screen.getByLabelText('trim.endTime'))
    await user.keyboard('5')
    expect(setEnd).toHaveBeenCalledWith('5')
  })

  it('renders the mapped range-error key from the hook', () => {
    vi.mocked(useTrim).mockReturnValue(
      createMockUseTrim({ rangeError: 'end_before_start' }),
    )

    renderWithProviders(<TrimContent />, { route: '/trim' })

    expect(screen.getByText('trim.error.end_before_start')).toBeInTheDocument()
  })

  it('selecting the reencode mode radio calls setMode', async () => {
    const setMode = vi.fn()
    vi.mocked(useTrim).mockReturnValue(createMockUseTrim({ setMode }))

    const { user } = renderWithProviders(<TrimContent />, { route: '/trim' })

    // Label text includes badge + tooltip aria text; match on the prefix.
    const [reencodeRadio] = screen.getAllByLabelText(/trim\.mode\.accurate/)
    await user.click(reencodeRadio)
    expect(setMode).toHaveBeenCalledWith('reencode')
  })

  it('renders progress with elapsed/remaining while trimming', () => {
    vi.mocked(useTrim).mockReturnValue(
      createMockUseTrim({
        status: 'trimming',
        progress: { progress: 42, currentTimeSec: 0, totalDurationSec: 0 },
        elapsedSec: 12,
        remainingSec: 125,
      }),
    )

    renderWithProviders(<TrimContent />, { route: '/trim' })

    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText(/trim\.elapsed/)).toHaveTextContent('0:12')
    expect(screen.getByText(/trim\.remaining/)).toHaveTextContent('2:05')
    expect(screen.getByText('trim.trimming')).toBeInTheDocument()
  })
})

describe('formatDuration (trim)', () => {
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
