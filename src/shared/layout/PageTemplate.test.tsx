/**
 * PageTemplate suite.
 *
 * Pure presentational frame: assert both header layouts and that
 * children land in the body wrapper.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PageTemplate } from './PageTemplate'

describe('PageTemplate', () => {
  it('renders a simple header with title and description', () => {
    renderWithProviders(
      <PageTemplate title="Page Title" description="Page description">
        <div>body-content</div>
      </PageTemplate>,
    )

    expect(
      screen.getByRole('heading', { name: 'Page Title' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Page description')).toBeInTheDocument()
    expect(screen.getByText('body-content')).toBeInTheDocument()
  })

  it('omits the description node when not provided', () => {
    renderWithProviders(
      <PageTemplate title="Page Title">
        <div>body-content</div>
      </PageTemplate>,
    )

    expect(screen.queryByText('Page description')).toBeNull()
  })

  it('renders the toolbar layout when actions are provided', () => {
    renderWithProviders(
      <PageTemplate
        title="Page Title"
        actions={<button type="button">action-button</button>}
      >
        <div>body-content</div>
      </PageTemplate>,
    )

    expect(screen.getByText('action-button')).toBeInTheDocument()
    expect(screen.getByText('body-content')).toBeInTheDocument()
  })
})
