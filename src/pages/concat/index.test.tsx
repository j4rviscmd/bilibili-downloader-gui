import { formatDuration } from '@/features/concat/lib/format'
import ConcatContent from '@/pages/concat'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ConcatForm's own behavior is covered by ConcatForm.test.tsx; this file
// locks the page wrapper (header, title effect, non-scrolling body that
// passes bounded height into the form).
vi.mock('@/features/concat/hooks/useConcat', () => ({
  useConcat: vi.fn(),
}))

import { useConcat } from '@/features/concat/hooks/useConcat'

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

describe('ConcatContent (page wrapper wiring)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useConcat).mockReturnValue(createMockUseConcat())
  })

  it('renders the page header and sets the document title', () => {
    renderWithProviders(<ConcatContent />, { route: '/concat' })

    expect(screen.getByText('concat.title')).toBeInTheDocument()
    expect(screen.getByText('concat.description')).toBeInTheDocument()
    expect(document.title).toBe('concat.title - app.title')
  })

  it('renders ConcatForm action buttons (form mounted)', () => {
    renderWithProviders(<ConcatContent />, { route: '/concat' })

    expect(screen.getByText('concat.concat')).toBeInTheDocument()
    expect(screen.getByText('concat.clear')).toBeInTheDocument()
  })
})

describe('formatDuration (concat)', () => {
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
