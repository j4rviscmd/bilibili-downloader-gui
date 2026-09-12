/**
 * DownloadSection suite (three-layer strategy — key wiring only).
 *
 * - '@/features/video' is mocked (videoApi reset on rename/omit toggles);
 *   TitleReplacementSettings stays real so its wiring is exercised here.
 * - useSettings stays real: assertions go through the seeded singleton
 *   store and the 'patch_settings' mockInvoke payload.
 */

import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen, waitFor } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const videoApiMock = vi.hoisted(() => ({
  // resetApiState() must return a dispatchable plain action
  util: { resetApiState: vi.fn().mockReturnValue({ type: 'videoApi/reset' }) },
}))

vi.mock('@/features/video', () => ({ videoApi: videoApiMock }))

import { open } from '@tauri-apps/plugin-dialog'
import { DownloadSection } from './DownloadSection'

const mockOpen = open as unknown as Mock

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

function seedSettings(partial: Partial<Settings> = {}) {
  store.dispatch(setSettings({ ...baseline, ...partial }))
}

describe('DownloadSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(undefined)
    seedSettings()
  })

  it('renders the seeded output path', () => {
    renderWithProviders(<DownloadSection />)

    expect(screen.getByDisplayValue('/downloads/out')).toBeInTheDocument()
  })

  // --- Download output path picker ------------------------------------------

  it('persists a picked download output directory through the dialog', async () => {
    seedSettings()
    mockOpen.mockResolvedValue('/downloads/out2')
    const { user } = renderWithProviders(<DownloadSection />)

    await user.click(
      screen.getByRole('button', { name: 'settings.output_dir_button' }),
    )

    await waitFor(() =>
      expect(lastSetSettings()).toMatchObject({
        dlOutputPath: '/downloads/out2',
      }),
    )
    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true }),
    )
  })

  it('keeps the output path when the directory dialog is cancelled', async () => {
    seedSettings()
    mockOpen.mockResolvedValue(null)
    const { user } = renderWithProviders(<DownloadSection />)

    await user.click(
      screen.getByRole('button', { name: 'settings.output_dir_button' }),
    )

    expect(lastSetSettings()).toBeUndefined()
  })

  it('shows the inline error and skips saving for an invalid picked path', async () => {
    // Picked paths come from the native dialog but can still be invalid
    // (e.g. a trailing space on Windows); validation must abort the save.
    seedSettings()
    mockOpen.mockResolvedValue('C:\\Users\\me<Videos')
    const { user } = renderWithProviders(<DownloadSection />)

    await user.click(
      screen.getByRole('button', { name: 'settings.output_dir_button' }),
    )

    expect(
      await screen.findByText('validation.path.windows.invalid_chars'),
    ).toBeInTheDocument()
    expect(lastSetSettings()).toBeUndefined()
  })

  it('survives a throwing directory dialog', async () => {
    seedSettings()
    mockOpen.mockRejectedValueOnce(new Error('dialog failed'))
    const { user } = renderWithProviders(<DownloadSection />)

    await user.click(
      screen.getByRole('button', { name: 'settings.output_dir_button' }),
    )

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'settings.output_dir_button' }),
      ).toBeEnabled(),
    )
  })

  // --- Radios and switches ---------------------------------------------------

  it('changing the parallelism persists the picked option', async () => {
    const { user } = renderWithProviders(<DownloadSection />)

    const two = screen.getByText('2').closest('button')!
    await user.click(two as HTMLElement)

    await waitFor(() =>
      expect(lastSetSettings()).toMatchObject({ downloadParallelism: 2 }),
    )
  })

  it('changing the video codec priority persists the picked option', async () => {
    const { user } = renderWithProviders(<DownloadSection />)

    const hevcCard = screen
      .getByText('settings.video_codec_hevc_first')
      .closest('button[aria-pressed]')!
    await user.click(hevcCard as HTMLElement)

    await waitFor(() =>
      expect(lastSetSettings()).toMatchObject({
        videoCodecPriority: 'hevcFirst',
      }),
    )
  })

  it('toggling auto-rename persists it and resets the video cache', async () => {
    const { user } = renderWithProviders(<DownloadSection />)

    const section = screen
      .getByText('settings.auto_rename_duplicates_label')
      .closest('div.flex.items-center.justify-between')!
    await user.click(
      section.querySelector('button[role="switch"]') as HTMLElement,
    )

    await waitFor(() =>
      expect(lastSetSettings()).toMatchObject({ autoRenameDuplicates: false }),
    )
    expect(videoApiMock.util.resetApiState).toHaveBeenCalled()
  })

  it('toggling omit duplicate part title persists it and resets the video cache', async () => {
    const { user } = renderWithProviders(<DownloadSection />)

    const section = screen
      .getByText('settings.omit_duplicate_part_title_label')
      .closest('div.flex.items-center.justify-between')!
    await user.click(
      section.querySelector('button[role="switch"]') as HTMLElement,
    )

    await waitFor(() =>
      expect(lastSetSettings()).toMatchObject({
        omitDuplicatePartTitle: false,
      }),
    )
    expect(videoApiMock.util.resetApiState).toHaveBeenCalled()
  })

  it('adding a title replacement rule persists the expanded list', async () => {
    const { user } = renderWithProviders(<DownloadSection />)

    await user.click(
      screen.getByRole('button', {
        name: 'settings.title_replacement.add_rule',
      }),
    )

    await waitFor(() =>
      expect(lastSetSettings()?.titleReplacements).toEqual([
        ...defaultRules(),
        { from: '', to: '', enabled: true },
      ]),
    )
  })
})

/** Mirrors DEFAULT_RULES in TitleReplacementSettings (backend defaults). */
function defaultRules() {
  return [
    { from: '/', to: '-', enabled: true },
    { from: ':', to: '_', enabled: true },
    { from: '*', to: 'x', enabled: true },
    { from: '?', to: '', enabled: true },
    { from: '"', to: "'", enabled: true },
    { from: '<', to: '(', enabled: true },
    { from: '>', to: ')', enabled: true },
    { from: '|', to: '-', enabled: true },
  ]
}
