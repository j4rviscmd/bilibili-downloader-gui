import { TooltipProvider } from '@/shared/animate-ui/radix/tooltip'
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
  it('keeps the section visible with only "off" selectable when no subtitles', () => {
    // The no-subtitle tooltips need an ancestor provider (CLAUDE.md pattern).
    renderWithProviders(
      <TooltipProvider>
        <SubtitleSection
          subtitles={[]}
          // Seeded default may be soft/hard; with no tracks the effective
          // mode is off and the other options disable themselves.
          config={{ mode: 'soft', selectedLans: ['zh'] }}
          disabled={false}
          page={1}
          onConfigChange={vi.fn()}
        />
      </TooltipProvider>,
    )

    expect(
      screen.getByRole('radio', { name: 'video.subtitle_off' }),
    ).toBeChecked()
    expect(
      screen.getByRole('radio', { name: 'video.subtitle_soft' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('radio', { name: 'video.subtitle_hard' }),
    ).toBeDisabled()
    // Forced-off display must not leak the soft language picker hint.
    expect(
      screen.queryByText('video.subtitle_select_multiple'),
    ).not.toBeInTheDocument()
  })

  it('explains the unselectable modes with the none-available tooltip', async () => {
    // delayDuration 0 keeps the hover→open wait short (Radix default 700ms).
    const { user: actor } = renderWithProviders(
      <TooltipProvider delayDuration={0}>
        <SubtitleSection
          subtitles={[]}
          config={offConfig}
          disabled={false}
          page={1}
          onConfigChange={vi.fn()}
        />
      </TooltipProvider>,
    )

    await actor.hover(screen.getByText('video.subtitle_soft'))

    // AnimatePresence may keep an exiting clone mounted; at least one
    // instance of the reason text must be open (FavoriteItem convention).
    expect(
      await screen.findAllByText('video.subtitle_none_available'),
    ).not.toHaveLength(0)
  })

  it('keeps the hard picker hidden and ignores clicks on unselectable modes', async () => {
    const onConfigChange = vi.fn()
    const { user: actor } = renderWithProviders(
      <TooltipProvider delayDuration={0}>
        <SubtitleSection
          subtitles={[]}
          // Seeded hard default: forced-off display must not leak the
          // language radios or the burn-in warning.
          config={{ mode: 'hard', selectedLans: ['zh'] }}
          disabled={false}
          page={1}
          onConfigChange={onConfigChange}
        />
      </TooltipProvider>,
    )

    // "off" stays interactive while the track-less modes gray out.
    expect(
      screen.getByRole('radio', { name: 'video.subtitle_off' }),
    ).toBeEnabled()

    // Disabled radios must swallow clicks: selecting soft/hard with zero
    // tracks would store an unusable config.
    await actor.click(
      screen.getByRole('radio', { name: 'video.subtitle_soft' }),
    )
    await actor.click(
      screen.getByRole('radio', { name: 'video.subtitle_hard' }),
    )
    expect(onConfigChange).not.toHaveBeenCalled()

    expect(
      screen.queryByText('video.subtitle_hard_warning'),
    ).not.toBeInTheDocument()
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
