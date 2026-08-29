import { RadioGroup } from '@/shared/animate-ui/radix/radio-group'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { QualityRadioGroup } from './QualityRadioGroup'

const options = [
  { id: '80', label: '1080p', isAvailable: true },
  { id: '64', label: '720p', isAvailable: true },
  { id: '120', label: '4K', isAvailable: false },
]

/** Renders the group inside the RadioGroup root it is used with in prod. */
function setup(onValueChange = vi.fn()) {
  const result = renderWithProviders(
    <RadioGroup value="" onValueChange={onValueChange}>
      <QualityRadioGroup options={options} idPrefix="vq-1" />
    </RadioGroup>,
  )
  return { ...result, onValueChange }
}

describe('QualityRadioGroup', () => {
  it('renders one radio per option with its label', () => {
    setup()

    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(screen.getByText('1080p')).toBeInTheDocument()
    expect(screen.getByText('720p')).toBeInTheDocument()
    expect(screen.getByText('4K')).toBeInTheDocument()
  })

  it('disables unavailable qualities and dims their label', () => {
    setup()

    expect(screen.getByRole('radio', { name: '4K' })).toBeDisabled()
    // The dimmed wrapper marks unavailable options visually
    expect(screen.getByText('4K').closest('div')).toHaveClass(
      'text-muted-foreground/60',
    )
  })

  it('keeps available qualities enabled', () => {
    setup()

    expect(screen.getByRole('radio', { name: '1080p' })).toBeEnabled()
  })

  it('selects a quality through the parent RadioGroup callback', async () => {
    const { onValueChange, user: actor } = setup()

    await actor.click(screen.getByRole('radio', { name: '1080p' }))

    expect(onValueChange).toHaveBeenCalledWith('80')
  })
})
