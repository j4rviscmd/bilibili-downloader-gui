import { logger } from '@/shared/lib/logger'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorBoundary } from './ErrorBoundary'

vi.mock('@/shared/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

/** Child that throws on render, to trip the boundary. */
function Bomb(): React.ReactNode {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Silence React's own rstack report of the caught error.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <p>healthy content</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('healthy content')).toBeInTheDocument()
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('renders the default fallback UI and logs via logger.error', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(
      screen.getByText(
        'An unexpected error occurred. Please restart the application.',
      ),
    ).toBeInTheDocument()
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      'React Error Boundary caught an error',
      expect.stringContaining('boom'),
    )
  })

  it('shows the raw error message in DEV', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )

    // import.meta.env.DEV is true under Vitest
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('renders a custom fallback instead of the default UI', () => {
    render(
      <ErrorBoundary fallback={<div>custom fallback</div>}>
        <Bomb />
      </ErrorBoundary>,
    )

    expect(screen.getByText('custom fallback')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })
})
