import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConcat } from '../hooks/useConcat'

import { ConcatForm } from './ConcatForm'

vi.mock('../hooks/useConcat', () => ({
  useConcat: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

/**
 * Builds a `useConcat` return value with sensible defaults, overlaid with
 * the given per-test overrides. Keeps each test focused on the state it
 * actually exercises instead of re-declaring the full handler surface.
 */
function createMockUseConcat(
  overrides: Partial<ReturnType<typeof useConcat>> = {},
): ReturnType<typeof useConcat> {
  return {
    files: [],
    outputPath: null,
    status: 'idle',
    validationError: null,
    progress: null,
    elapsedSec: 0,
    remainingSec: null,
    handleAddFiles: vi.fn(),
    handleRemoveFile: vi.fn(),
    handleReorderFiles: vi.fn(),
    handleChooseOutput: vi.fn(),
    handleConcat: vi.fn(),
    handleReveal: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useConcat>
}

describe('ConcatForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useConcat).mockReturnValue(createMockUseConcat())
  })

  // jsdom cannot compute real layout/scroll geometry, so these tests lock
  // the structural contract that fixes issue #461: the action buttons stay
  // rendered and the file list sits inside a bounded scroll region.

  it('keeps action buttons rendered when the file list is long (#461)', () => {
    vi.mocked(useConcat).mockReturnValue(
      createMockUseConcat({
        files: Array.from({ length: 50 }, (_, i) => `/p/video-${i}.mp4`),
        outputPath: '/out.mp4',
      }),
    )

    render(<ConcatForm />)

    // The Concat / Clear buttons live in a `shrink-0` action row, so they
    // remain in the DOM (and visible in a real browser) regardless of how
    // many files are in the list.
    expect(screen.getByText('concat.concat')).toBeInTheDocument()
    expect(screen.getByText('concat.clear')).toBeInTheDocument()
  })

  it('wraps the file list in a bounded scroll region when files exist', () => {
    vi.mocked(useConcat).mockReturnValue(
      createMockUseConcat({
        files: ['/p/a.mp4', '/p/b.mp4'],
      }),
    )

    const { container } = render(<ConcatForm />)

    // The file-list region uses the bounded-flex idiom so it scrolls
    // internally without pushing the output section or action buttons
    // off-screen.
    const scrollRegion = container.querySelector('.overflow-y-auto')
    expect(scrollRegion).toHaveClass('min-h-0', 'flex-1', 'overflow-y-auto')
  })
})
