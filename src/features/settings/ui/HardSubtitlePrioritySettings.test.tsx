/**
 * HardSubtitlePrioritySettings suite.
 *
 * The picker is controlled: click order is priority, new picks insert
 * before the "*" wildcard, and the last remaining pick cannot be
 * unchecked. A stateful harness exercises multi-click sequences against
 * the real component; `onChange` payloads are asserted directly (the
 * DownloadSection suite already covers the patch_settings wiring).
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { HardSubtitlePrioritySettings } from './HardSubtitlePrioritySettings'

function Harness({
  initial,
  onChange,
}: {
  initial: string[]
  onChange: (lans: string[]) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <HardSubtitlePrioritySettings
      value={value}
      onChange={(next) => {
        onChange(next)
        setValue(next)
      }}
    />
  )
}

function renderPicker(initial: string[]) {
  const onChange = vi.fn<(lans: string[]) => void>()
  const result = renderWithProviders(
    <Harness initial={initial} onChange={onChange} />,
  )
  return { ...result, onChange }
}

describe('HardSubtitlePrioritySettings', () => {
  it('renders a priority badge on every checked option', () => {
    renderPicker(['ja', 'en', '*'])

    // t() is identity in tests; the badge span renders the raw key.
    expect(screen.getByText('日本語')).toHaveTextContent(
      'search.subtitle_priority',
    )
    expect(screen.getByText('English')).toHaveTextContent(
      'search.subtitle_priority',
    )
    expect(
      screen.getByText('settings.subtitle_hard_lans_fallback'),
    ).toHaveTextContent('search.subtitle_priority')
    // Unchecked languages carry no badge.
    expect(screen.getByText('中文(简体)')).not.toHaveTextContent(
      'search.subtitle_priority',
    )
    expect(screen.getByText('한국어')).not.toHaveTextContent(
      'search.subtitle_priority',
    )
  })

  it('inserts a newly checked language before the wildcard', async () => {
    const { user, onChange } = renderPicker(['zh-Hans', '*'])

    await user.click(screen.getByText('日本語'))

    expect(onChange).toHaveBeenCalledWith(['zh-Hans', 'ja', '*'])
    // Controlled update keeps both checked options badged.
    expect(screen.getByText('日本語')).toHaveTextContent(
      'search.subtitle_priority',
    )
  })

  it('appends a newly checked language when the wildcard is off', async () => {
    const { user, onChange } = renderPicker(['zh-Hans'])

    await user.click(screen.getByText('English'))

    expect(onChange).toHaveBeenCalledWith(['zh-Hans', 'en'])
  })

  it('appends the wildcard last when checked', async () => {
    const { user, onChange } = renderPicker(['ja'])

    await user.click(screen.getByText('settings.subtitle_hard_lans_fallback'))

    expect(onChange).toHaveBeenCalledWith(['ja', '*'])
  })

  it('unchecks a non-last language and keeps the remaining order', async () => {
    const { user, onChange } = renderPicker(['ja', 'en', '*'])

    await user.click(screen.getByText('日本語'))

    expect(onChange).toHaveBeenCalledWith(['en', '*'])
    expect(screen.getByText('English')).toHaveTextContent(
      'search.subtitle_priority',
    )
    expect(screen.getByText('日本語')).not.toHaveTextContent(
      'search.subtitle_priority',
    )
  })

  it('keeps the last checked language when unchecked', async () => {
    const { user, onChange } = renderPicker(['ja'])

    await user.click(screen.getByText('日本語'))

    // onChange never fires: hard-sub needs at least one pick.
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByText('日本語')).toHaveTextContent(
      'search.subtitle_priority',
    )
  })

  it('does not mutate the value array passed in', async () => {
    const initial = ['zh-Hans', '*']
    const { user } = renderPicker(initial)

    await user.click(screen.getByText('日本語'))

    expect(initial).toEqual(['zh-Hans', '*'])
  })
})
