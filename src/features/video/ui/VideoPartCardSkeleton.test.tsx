/**
 * VideoPartCardSkeleton suite.
 *
 * Structural smoke test: the skeleton mirrors the card layout with
 * placeholder rows (6 video-quality + 4 audio-quality placeholders).
 */

import { renderWithProviders } from '@/test/test-utils'
import { describe, expect, it } from 'vitest'

import VideoPartCardSkeleton from './VideoPartCardSkeleton'

describe('VideoPartCardSkeleton', () => {
  it('renders the thumbnail, title and quality placeholder rows', () => {
    const { container } = renderWithProviders(<VideoPartCardSkeleton />)

    const skeletons = container.querySelectorAll('[data-slot="skeleton"]')
    // 6 top-level layout blocks + 6 video + 4 audio radio placeholders
    expect(skeletons.length).toBeGreaterThanOrEqual(16)
  })
})
