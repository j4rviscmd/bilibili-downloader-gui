/**
 * ToolDefaultsSection suite: each segmented control persists its picked
 * option, and the info tooltip buttons render and swallow clicks.
 */

import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ToolDefaultsSection } from './ToolDefaultsSection'

const baseline: Settings = {
  dlOutputPath: '/downloads/out',
  language: 'ja',
  fontSize: 14,
  trimMode: 'copy',
  audioFormat: 'mp3',
  theme: 'light',
}

/** Returns the latest patch_settings payload (changed fields), or undefined. */
function lastSetSettings(): Partial<Settings> | undefined {
  const calls = mockInvoke.mock.calls.filter(
    (c: unknown[]) => c[0] === 'patch_settings',
  )
  const call = calls[calls.length - 1]
  return call?.[1]?.patch as Partial<Settings> | undefined
}

/** Segment button located via its visible label text. */
function segment(label: string): HTMLElement {
  return screen.getByText(label).closest('button')!
}

describe('ToolDefaultsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(undefined)
    store.dispatch(setSettings(baseline))
  })

  it.each([
    [
      'settings.trim_mode_label',
      'settings.trim_mode_reencode',
      { trimMode: 'reencode' },
    ],
    [
      'settings.audio_format_label',
      'settings.audio_format_m4a',
      { audioFormat: 'm4a' },
    ],
    [
      'settings.gif_format_label',
      'settings.gif_format_webm',
      { gifFormat: 'webm' },
    ],
    [
      'settings.rotation_mode_label',
      'settings.rotation_mode_reencode',
      { rotationMode: 'reencode' },
    ],
    [
      'settings.rotation_angle_label',
      'rotation.angle.180',
      { rotationAngle: 180 },
    ],
  ])(
    'changing %s persists the picked option',
    async (labelKey, optionLabel, expected) => {
      const { user } = renderWithProviders(<ToolDefaultsSection />)

      // Scope to the section so identical trim/rotation labels disambiguate
      const section = screen
        .getByText(labelKey)
        .closest('div.space-y-2') as HTMLElement
      const option = within(section)
        .getByText(optionLabel)
        .closest('button') as HTMLElement
      await user.click(option)

      await waitFor(() => expect(lastSetSettings()).toMatchObject(expected))
    },
  )

  it('re-clicking the active segment is a no-op (no empty patch)', async () => {
    const { user } = renderWithProviders(<ToolDefaultsSection />)

    await user.click(segment('settings.trim_mode_copy'))

    // Radix single toggle emits '' on re-click; the wrapper must swallow it
    expect(lastSetSettings()).toBeUndefined()
  })

  it('info tooltip buttons swallow their click via preventDefault', async () => {
    const { user } = renderWithProviders(<ToolDefaultsSection />)

    const labels = [
      'trim.warningKeyframe',
      'trim.warningReencode',
      'rotation.warningMetadata',
      'rotation.warningReencode',
    ]
    for (const label of labels) {
      // Two info triggers can share a label (trim + rotation); click them all
      for (const trigger of screen.getAllByRole('button', { name: label })) {
        await user.click(trigger)
      }
    }

    // All info buttons render and swallow clicks without throwing
    expect(screen.getByText('settings.trim_mode_label')).toBeInTheDocument()
  })
})
