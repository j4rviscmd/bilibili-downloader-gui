/**
 * Pagination suite. Page links report through onClick, the active link is
 * marked with aria-current, and previous/next/ellipsis render their labels.
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from './pagination'

function renderPagination(onPageChange: (page: string) => void) {
  return renderWithProviders(
    <Pagination data-testid="pagination">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#" />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" isActive>
            1
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href="#" onClick={() => onPageChange('2')}>
            2
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationEllipsis />
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#" />
        </PaginationItem>
      </PaginationContent>
    </Pagination>,
  )
}

describe('Pagination', () => {
  it('renders the nav with the pagination aria-label', () => {
    renderPagination(vi.fn())

    const nav = screen.getByRole('navigation', { name: 'pagination' })
    expect(nav).toHaveAttribute('data-slot', 'pagination')
  })

  it('marks the active link with aria-current and the outline variant', () => {
    renderPagination(vi.fn())

    const active = screen.getByText('1')
    expect(active).toHaveAttribute('aria-current', 'page')
    // The outline variant adds the bordered background treatment...
    expect(active.className).toContain('bg-background')

    const inactive = screen.getByText('2')
    expect(inactive).not.toHaveAttribute('aria-current')
    // ...which the ghost variant lacks.
    expect(inactive.className).not.toContain('bg-background')
  })

  it('reports page clicks through the link onClick', async () => {
    const onPageChange = vi.fn()
    const user = userEvent.setup()
    renderPagination(onPageChange)

    await user.click(screen.getByText('2'))

    expect(onPageChange).toHaveBeenCalledTimes(1)
    expect(onPageChange).toHaveBeenCalledWith('2')
  })

  it('renders default Previous/Next labels and the ellipsis', () => {
    renderPagination(vi.fn())

    expect(screen.getByLabelText('Go to previous page')).toHaveTextContent(
      'Previous',
    )
    expect(screen.getByLabelText('Go to next page')).toHaveTextContent('Next')
    // Ellipsis is aria-hidden; assert through its data-slot.
    expect(
      document.querySelector('[data-slot="pagination-ellipsis"]'),
    ).not.toBeNull()
  })

  it('accepts custom children labels on previous and next', () => {
    renderWithProviders(
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious href="#">Prev</PaginationPrevious>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext href="#">Next page</PaginationNext>
        </PaginationItem>
      </PaginationContent>,
    )

    expect(screen.getByLabelText('Go to previous page')).toHaveTextContent(
      'Prev',
    )
    expect(screen.getByLabelText('Go to next page')).toHaveTextContent(
      'Next page',
    )
  })
})
