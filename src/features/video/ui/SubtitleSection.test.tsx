import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { SubtitleConfig } from '../types'
import { SubtitleSection } from './SubtitleSection'

const subtitles = [
  { lan: 'zh', lanDoc: 'Chinese', isAi: false },
  { lan: 'ai-zh', lanDoc: 'AI Chinese', isAi: true },
]

const offConfig: SubtitleConfig = { mode: 'off', selectedLans: [] }

/** Renders the section in the given config, returning the change spy. */
function setup(config: SubtitleConfig, disabled = false) {
  const onConfigChange = vi.fn()
  const result = renderWithProviders(
    <SubtitleSection
      subtitles={subtitles}
      config={config}
      disabled={disabled}
      page={1}
      onConfigChange={onConfigChange}
    />,
  )
  return { ...result, onConfigChange }
}

describe('SubtitleSection', () => {
  it('renders nothing when the part has no subtitles', () => {
    const { container } = renderWithProviders(
      <SubtitleSection
        subtitles={[]}
        config={offConfig}
        disabled={false}
        page={1}
        onConfigChange={vi.fn()}
      />,
    )

    expect(container.innerHTML).toBe('')
  })

  it('renders the off/soft/hard mode options', () => {
    setup(offConfig)

    expect(screen.getByText('video.subtitle_off')).toBeInTheDocument()
    expect(screen.getByText('video.subtitle_soft')).toBeInTheDocument()
    expect(screen.getByText('video.subtitle_hard')).toBeInTheDocument()
    // Mode 'off' renders no language list
    expect(
      screen.queryByText('video.subtitle_select_multiple'),
    ).not.toBeInTheDocument()
  })

  it('selecting soft mode reports every language as selected', async () => {
    const { onConfigChange, user: actor } = setup(offConfig)

    await actor.click(
      screen.getByRole('radio', { name: 'video.subtitle_soft' }),
    )

    expect(onConfigChange).toHaveBeenCalledWith({
      mode: 'soft',
      selectedLans: ['zh', 'ai-zh'],
    })
  })

  it('selecting hard mode reports only the first language', async () => {
    const { onConfigChange, user: actor } = setup(offConfig)

    await actor.click(
      screen.getByRole('radio', { name: 'video.subtitle_hard' }),
    )

    expect(onConfigChange).toHaveBeenCalledWith({
      mode: 'hard',
      selectedLans: ['zh'],
    })
  })

  it('soft mode lists every language with checkboxes and the AI badge', async () => {
    const softConfig: SubtitleConfig = {
      mode: 'soft',
      selectedLans: ['zh', 'ai-zh'],
    }
    const { onConfigChange, user: actor } = setup(softConfig)

    expect(
      screen.getByText('video.subtitle_select_multiple'),
    ).toBeInTheDocument()
    expect(screen.getByText('Chinese')).toBeInTheDocument()
    expect(screen.getByText('AI Chinese')).toBeInTheDocument()
    // AI-generated subtitles are badged
    expect(screen.getByText('AI')).toBeInTheDocument()

    // The soft-mode checkboxes carry no accessible name (no htmlFor wiring),
    // so locate positionally: they render in subtitle order.
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(2)
    const aiCheckbox = checkboxes[1]!
    expect(aiCheckbox).toBeChecked()

    await actor.click(aiCheckbox)
    expect(onConfigChange).toHaveBeenCalledWith({
      mode: 'soft',
      selectedLans: ['zh'],
    })
  })

  it('hard mode shows a radio per language plus the burn-in warning', async () => {
    const hardConfig: SubtitleConfig = { mode: 'hard', selectedLans: ['zh'] }
    const { onConfigChange, user: actor } = setup(hardConfig)

    expect(screen.getByText('video.subtitle_hard_warning')).toBeInTheDocument()

    // Hard subtitles burn exactly one language track into the video
    await actor.click(screen.getByRole('radio', { name: /AI Chinese/ }))
    expect(onConfigChange).toHaveBeenCalledWith({
      mode: 'hard',
      selectedLans: ['ai-zh'],
    })
  })

  it('disables the mode controls when disabled', () => {
    setup(offConfig, true)

    expect(
      screen.getByRole('radio', { name: 'video.subtitle_soft' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('radio', { name: 'video.subtitle_hard' }),
    ).toBeDisabled()
  })
})
