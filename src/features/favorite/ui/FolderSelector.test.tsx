/**
 * FolderSelector suite.
 *
 * Loading/empty guards, the localized default-folder label, and the
 * onSelect wiring through the Select dropdown.
 */

import type { FavoriteFolder } from '@/features/favorite/types'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import FolderSelector from './FolderSelector'

beforeAll(() => {
  // Radix Select calls these pointer APIs on open; happy-dom lacks them.
  const stub = (name: string, impl: () => unknown) => {
    if (!(name in Element.prototype)) {
      Object.defineProperty(Element.prototype, name, {
        value: impl,
        configurable: true,
      })
    }
  }
  stub('hasPointerCapture', () => false)
  stub('setPointerCapture', () => {})
  stub('releasePointerCapture', () => {})
})

const folders: FavoriteFolder[] = [
  { id: 10, title: '默认收藏夹', mediaCount: 120 },
  { id: 20, title: 'My Collection', mediaCount: 7 },
]

describe('FolderSelector', () => {
  it('shows the loading indicator while folders are loading', () => {
    const { container } = renderWithProviders(
      <FolderSelector
        folders={[]}
        selectedId={null}
        onSelect={vi.fn()}
        loading
      />,
    )

    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('renders nothing when the folder list is empty', () => {
    const { container } = renderWithProviders(
      <FolderSelector folders={[]} selectedId={null} onSelect={vi.fn()} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('renders the localized default folder name alongside custom folders', async () => {
    const { user } = renderWithProviders(
      <FolderSelector folders={folders} selectedId={10} onSelect={vi.fn()} />,
    )

    // API default folder name is swapped for the localized label
    expect(screen.getByText('favorite.defaultFolder')).toBeInTheDocument()

    await user.click(screen.getByRole('combobox'))
    expect(
      await screen.findByRole('option', { name: /My Collection/ }),
    ).toBeInTheDocument()
    // Media counts render next to each folder title
    expect(screen.getByText('(7)')).toBeInTheDocument()
  })

  it('reports the picked folder id through onSelect', async () => {
    const onSelect = vi.fn()
    const { user } = renderWithProviders(
      <FolderSelector folders={folders} selectedId={10} onSelect={onSelect} />,
    )

    await user.click(screen.getByRole('combobox'))
    await user.click(
      await screen.findByRole('option', { name: /My Collection/ }),
    )

    expect(onSelect).toHaveBeenCalledWith(20)
  })
})
