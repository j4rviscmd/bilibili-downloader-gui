import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { VideoListSkeleton } from './VideoListSkeleton'

describe('VideoListSkeleton', () => {
  it('renders one placeholder row per requested row inside a busy region', () => {
    renderWithProviders(<VideoListSkeleton rows={3} label="Loading..." />)

    const region = screen.getByText('Loading...').parentElement!
    const rows = region.querySelector('ul[aria-hidden="true"]')
    expect(region).toHaveAttribute('aria-busy', 'true')
    expect(rows?.children).toHaveLength(3)
  })
})
