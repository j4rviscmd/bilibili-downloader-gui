/**
 * FileList suite.
 *
 * happy-dom cannot drive @dnd-kit pointer sensors, so DndContext is
 * stubbed to capture `onDragEnd` and SortableContext/useSortable to
 * pass-through stubs — the drag-end index resolution branches are then
 * exercised by invoking the captured handler directly (same technique
 * as the Virtuoso stub in FavoriteList.test.tsx).
 */

import { renderWithProviders } from '@/test/test-utils'
import type { DragEndEvent } from '@dnd-kit/core'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dnd = vi.hoisted(() => ({
  onDragEnd: null as null | ((e: DragEndEvent) => void),
}))

vi.mock('@dnd-kit/core', async (importActual) => {
  const actual = await importActual<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: ({
      children,
      onDragEnd,
    }: {
      children: React.ReactNode
      onDragEnd: (e: DragEndEvent) => void
    }) => {
      dnd.onDragEnd = onDragEnd
      return children
    },
  }
})

vi.mock('@dnd-kit/sortable', async (importActual) => {
  const actual = await importActual<typeof import('@dnd-kit/sortable')>()
  return {
    ...actual,
    SortableContext: ({ children }: { children: React.ReactNode }) => children,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: null,
      isDragging: false,
    }),
  }
})

import { FileList } from './FileList'

const FILES = ['/media/a.mp4', '/media/b.mp4', '/media/c.mp4']

function renderList(props: Partial<Parameters<typeof FileList>[0]> = {}) {
  const onRemove = vi.fn()
  const onReorder = vi.fn()
  renderWithProviders(
    <FileList
      files={FILES}
      isProcessing={false}
      onRemove={onRemove}
      onReorder={onReorder}
      {...props}
    />,
  )
  return { onRemove, onReorder }
}

/** Fires the captured drag-end handler with minimal active/over ids. */
function drag(active: string, over: string | null) {
  dnd.onDragEnd!({
    active: { id: active },
    over: over === null ? null : { id: over },
  } as DragEndEvent)
}

describe('FileList', () => {
  beforeEach(() => {
    dnd.onDragEnd = null
  })

  it('renders every file with its position index and basename only', () => {
    renderList()

    expect(screen.getByText('1.')).toBeInTheDocument()
    expect(screen.getByText('2.')).toBeInTheDocument()
    expect(screen.getByText('3.')).toBeInTheDocument()
    expect(screen.getByText('a.mp4')).toBeInTheDocument()
    // Directory part is kept out of the visible name (title attr only)
    expect(screen.queryByText('/media/a.mp4')).toBeNull()
  })

  it('reports the remove click with the item index', () => {
    const { onRemove } = renderList()

    // Second remove button (by aria label) belongs to b.mp4 at index 1
    const buttons = screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('aria-label') === 'concat.removeFileAria')
    expect(buttons).toHaveLength(3)
    buttons[1]!.click()

    expect(onRemove).toHaveBeenCalledWith(1)
  })

  it('disables drag and remove controls while processing', () => {
    renderList({ isProcessing: true })

    const disabled = screen
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('disabled'))
    // 3 grip handles + 3 remove buttons
    expect(disabled).toHaveLength(6)
  })

  it('reorders when the drag ends on a different file', () => {
    const { onReorder } = renderList()

    drag('/media/a.mp4', '/media/c.mp4')

    expect(onReorder).toHaveBeenCalledWith(0, 2)
  })

  it('ignores a drop on the same item', () => {
    const { onReorder } = renderList()

    drag('/media/a.mp4', '/media/a.mp4')

    expect(onReorder).not.toHaveBeenCalled()
  })

  it('ignores a drop outside the list', () => {
    const { onReorder } = renderList()

    drag('/media/a.mp4', null)

    expect(onReorder).not.toHaveBeenCalled()
  })

  it('ignores ids that are not in the list', () => {
    const { onReorder } = renderList()

    drag('/media/x.mp4', '/media/c.mp4')

    expect(onReorder).not.toHaveBeenCalled()
  })
})
