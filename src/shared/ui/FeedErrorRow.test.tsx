/**
 * FeedErrorRow suite. Shared one-line failure row: translated message +
 * retry button, with the raw backend error kept for screen readers and
 * diagnostics (labels arrive pre-translated; each feature keeps its own
 * i18n namespace).
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FeedErrorRow } from './FeedErrorRow'

describe('FeedErrorRow', () => {
  it('renders the message with a working retry and the raw error for screen readers', async () => {
    const onRetry = vi.fn()
    const { user } = renderWithProviders(
      <FeedErrorRow
        error="ERR::RATE_LIMITED"
        message="Failed to load"
        retryLabel="Retry"
        onRetry={onRetry}
      />,
    )

    expect(screen.getByText('Failed to load')).toBeInTheDocument()
    // Raw backend code renders screen-reader-only: diagnostics without
    // visual noise.
    expect(screen.getByText('ERR::RATE_LIMITED')).toHaveClass('sr-only')

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
