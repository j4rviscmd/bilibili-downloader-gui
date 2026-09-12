import { Switch } from '@/shared/ui/switch'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SettingField, SettingRow } from './SettingRow'

describe('SettingRow', () => {
  it('renders label, description and control on one row', () => {
    renderWithProviders(
      <SettingRow label="row-label" description="row-description">
        <Switch checked aria-label="row-switch" />
      </SettingRow>,
    )

    expect(screen.getByText('row-label')).toBeInTheDocument()
    expect(screen.getByText('row-description')).toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: 'row-switch' }),
    ).toBeInTheDocument()
  })

  it('omits the description paragraph when not provided', () => {
    renderWithProviders(
      <SettingRow label="bare-label">
        <span />
      </SettingRow>,
    )

    expect(screen.getByText('bare-label')).toBeInTheDocument()
    // No empty description slot: label block contains only the label.
    expect(
      screen.getByText('bare-label').closest('div')?.children,
    ).toHaveLength(1)
  })
})

describe('SettingField', () => {
  it('stacks label, description and control vertically', () => {
    renderWithProviders(
      <SettingField label="field-label" description="field-description">
        <input aria-label="field-input" />
      </SettingField>,
    )

    expect(screen.getByText('field-label')).toBeInTheDocument()
    expect(screen.getByText('field-description')).toBeInTheDocument()
    expect(screen.getByLabelText('field-input')).toBeInTheDocument()
  })
})
