/**
 * CategoryNav suite: category list rendering, active highlight and
 * aria-current landmark. Under vitest `import.meta.env.DEV` is true, so
 * the dev category is present (release exclusion is compile-time).
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CategoryNav } from './CategoryNav'

describe('CategoryNav', () => {
  it('renders every category including dev', () => {
    renderWithProviders(<CategoryNav active="general" onSelect={vi.fn()} />)

    for (const key of [
      'settings.category.general',
      'settings.category.download',
      'settings.category.storage',
      'settings.category.notifications',
      'settings.category.toolDefaults',
      'settings.category.account',
      'settings.category.about',
      'settings.category.dev',
    ]) {
      expect(screen.getByText(key)).toBeInTheDocument()
    }
  })

  it('marks only the active category with aria-current', () => {
    renderWithProviders(<CategoryNav active="download" onSelect={vi.fn()} />)

    expect(
      screen.getByText('settings.category.download').closest('button'),
    ).toHaveAttribute('aria-current', 'true')
    expect(
      screen.getByText('settings.category.general').closest('button'),
    ).not.toHaveAttribute('aria-current')
  })

  it('reports the clicked category id', async () => {
    const onSelect = vi.fn()
    const { user } = renderWithProviders(
      <CategoryNav active="general" onSelect={onSelect} />,
    )

    await user.click(screen.getByText('settings.category.account'))

    expect(onSelect).toHaveBeenCalledWith('account')
  })
})
