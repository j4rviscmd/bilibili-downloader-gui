/**
 * TitleReplacementSettings suite.
 *
 * Renders the real component against the singleton store seeded via
 * setSettings BEFORE render (the store is shared across tests), and
 * asserts every mutation persists through the 'patch_settings' invoke
 * payload (useSettings is real). Rule rows are located via their
 * read-only Input display values.
 */

import { store } from '@/app/store'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings, TitleReplacement } from '@/features/settings/type'
import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TitleReplacementSettings } from './TitleReplacementSettings'

const baseline: Settings = {
  dlOutputPath: '/downloads',
  language: 'en',
  fontSize: 14,
  trimMode: 'copy',
  audioFormat: 'mp3',
  theme: 'light',
}

/** Two concrete rules so row locators stay unambiguous: one locked
 * system rule (/) and one custom rule. */
const rules: TitleReplacement[] = [
  { from: '/', to: '-', enabled: true },
  { from: 'a', to: 'b', enabled: false },
]

/** Returns the rule row (grid div) containing the given Input value. */
function rowOf(value: string): HTMLElement {
  const input = document.querySelector<HTMLInputElement>(
    `input[value="${value}"]`,
  )
  expect(input, `expected a rule input with value "${value}"`).toBeTruthy()
  return input!.closest('div.grid') as HTMLElement
}

function seed(partial: Partial<Settings> = {}) {
  store.dispatch(setSettings({ ...baseline, ...partial }))
}

describe('TitleReplacementSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(undefined)
    seed()
  })

  it('shows the default-rules note and backend default rules when unset', () => {
    renderWithProviders(<TitleReplacementSettings />)

    // settings.titleReplacements is undefined -> the 8 DEFAULT_RULES render
    const froms = ['/', ':', '*', '?', '"', '<', '>', '|']
    for (const from of froms) {
      expect(screen.getByDisplayValue(from)).toBeInTheDocument()
    }
    expect(
      screen.getByText('settings.title_replacement.default_rules_note'),
    ).toBeInTheDocument()
  })

  it('adds a rule and persists the merged list', async () => {
    seed({ titleReplacements: rules })
    const { user } = renderWithProviders(<TitleReplacementSettings />)

    await user.click(
      screen.getByRole('button', {
        name: 'settings.title_replacement.add_rule',
      }),
    )

    // The save merges the missing system rules into the seeded pair.
    const call = mockInvoke.mock.calls.find((c) => c[0] === 'patch_settings')
    expect(call?.[1]).toMatchObject({
      patch: {
        titleReplacements: [
          { from: '/', to: '-', enabled: true },
          { from: 'a', to: 'b', enabled: false },
          { from: ':', to: '_', enabled: true },
          { from: '*', to: 'x', enabled: true },
          { from: '?', to: '', enabled: true },
          { from: '"', to: "'", enabled: true },
          { from: '<', to: '(', enabled: true },
          { from: '>', to: ')', enabled: true },
          { from: '|', to: '-', enabled: true },
          { from: '', to: '', enabled: true },
        ],
      },
    })
  })

  it('locks system rules: switch disabled, no delete button; toggle works only on custom rules', async () => {
    seed({ titleReplacements: rules })
    renderWithProviders(<TitleReplacementSettings />)

    const systemRow = rowOf('/')
    expect(within(systemRow).getByRole('switch')).toBeDisabled()
    // System rows render only the edit (Pencil) action.
    expect(within(systemRow).getAllByRole('button')).toHaveLength(1)

    // A seeded-disabled system rule would render enabled (merge repairs).
    seed({ titleReplacements: [{ from: ':', to: '_', enabled: false }] })
    const view = renderWithProviders(<TitleReplacementSettings />)
    const repaired = within(rowOf(':')).getByRole('switch')
    expect(repaired).toBeDisabled()
    expect((repaired as HTMLButtonElement).getAttribute('aria-checked')).toBe(
      'true',
    )
    view.unmount()
  })

  it('toggles a custom rule enabled state', async () => {
    seed({ titleReplacements: rules })
    const { user } = renderWithProviders(<TitleReplacementSettings />)

    await user.click(within(rowOf('a')).getByRole('switch'))

    const call = mockInvoke.mock.calls.find((c) => c[0] === 'patch_settings')
    expect(call?.[1]).toMatchObject({
      patch: {
        titleReplacements: expect.arrayContaining([
          { from: '/', to: '-', enabled: true },
          { from: 'a', to: 'b', enabled: true },
        ]),
      },
    })
  })

  it('edits a custom rule from/to values and saves on OK', async () => {
    seed({ titleReplacements: rules })
    const { user } = renderWithProviders(<TitleReplacementSettings />)

    const row = rowOf('a')
    await user.click(within(row).getAllByRole('button')[0])

    const [fromInput, toInput] = within(row).getAllByRole('textbox')
    await user.clear(fromInput)
    await user.type(fromInput, '?')
    await user.clear(toInput)
    await user.type(toInput, 'x')
    await user.click(within(row).getByRole('button', { name: 'OK' }))

    const call = mockInvoke.mock.calls.find((c) => c[0] === 'patch_settings')
    expect(call?.[1]).toMatchObject({
      patch: {
        titleReplacements: expect.arrayContaining([
          { from: '/', to: '-', enabled: true },
          { from: '?', to: 'x', enabled: true },
        ]),
      },
    })
  })

  it('edits a system rule: only the replacement text changes', async () => {
    seed({ titleReplacements: rules })
    const { user } = renderWithProviders(<TitleReplacementSettings />)

    const row = rowOf('/')
    await user.click(within(row).getAllByRole('button')[0])

    const [fromInput, toInput] = within(row).getAllByRole('textbox')
    expect(fromInput).toHaveAttribute('readonly')
    await user.clear(toInput)
    await user.type(toInput, 'x')
    await user.click(within(row).getByRole('button', { name: 'OK' }))

    const call = mockInvoke.mock.calls.find((c) => c[0] === 'patch_settings')
    expect(call?.[1]).toMatchObject({
      patch: {
        titleReplacements: expect.arrayContaining([
          { from: '/', to: 'x', enabled: true },
          { from: 'a', to: 'b', enabled: false },
        ]),
      },
    })
  })

  it('strips forbidden characters from a system rule replacement text', async () => {
    seed({ titleReplacements: rules })
    const { user } = renderWithProviders(<TitleReplacementSettings />)

    const row = rowOf('/')
    await user.click(within(row).getAllByRole('button')[0])

    const [, toInput] = within(row).getAllByRole('textbox')
    await user.clear(toInput)
    await user.type(toInput, 'a/b')
    await user.click(within(row).getByRole('button', { name: 'OK' }))

    const call = mockInvoke.mock.calls.find((c) => c[0] === 'patch_settings')
    expect(call?.[1]).toMatchObject({
      patch: {
        titleReplacements: expect.arrayContaining([
          { from: '/', to: 'ab', enabled: true },
        ]),
      },
    })
  })

  it('deletes a custom rule (system rules keep rendering)', async () => {
    seed({ titleReplacements: rules })
    const { user } = renderWithProviders(<TitleReplacementSettings />)

    // Custom rows render [edit, delete]; system rows only [edit].
    await user.click(within(rowOf('a')).getAllByRole('button')[1])

    const call = mockInvoke.mock.calls.find((c) => c[0] === 'patch_settings')
    expect(call?.[1]).toMatchObject({
      patch: {
        titleReplacements: [
          { from: '/', to: '-', enabled: true },
          { from: ':', to: '_', enabled: true },
          { from: '*', to: 'x', enabled: true },
          { from: '?', to: '', enabled: true },
          { from: '"', to: "'", enabled: true },
          { from: '<', to: '(', enabled: true },
          { from: '>', to: ')', enabled: true },
          { from: '|', to: '-', enabled: true },
        ],
      },
    })
  })

  it('disables add and warns at MAX_RULES (20)', () => {
    // 12 custom rules: the 8 system rules fill the rest of the cap.
    seed({
      titleReplacements: Array.from({ length: 12 }, (_, i) => ({
        from: `c${i}`,
        to: String(i),
        enabled: true,
      })),
    })
    renderWithProviders(<TitleReplacementSettings />)

    expect(
      screen.getByRole('button', {
        name: 'settings.title_replacement.add_rule',
      }),
    ).toBeDisabled()
    expect(
      screen.getByText('settings.title_replacement.max_rules_reached'),
    ).toBeInTheDocument()
  })

  it('an emptied rules array still renders the system rules', () => {
    seed({ titleReplacements: [] })
    renderWithProviders(<TitleReplacementSettings />)

    for (const from of ['/', ':', '*', '?', '"', '<', '>', '|']) {
      expect(screen.getByDisplayValue(from)).toBeInTheDocument()
    }
    expect(
      screen.queryByText('settings.title_replacement.empty_rules_note'),
    ).not.toBeInTheDocument()
  })
})
