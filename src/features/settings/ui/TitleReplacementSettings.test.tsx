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

/** Two concrete rules so row locators stay unambiguous. */
const rules: TitleReplacement[] = [
  { from: '/', to: '-', enabled: true },
  { from: ':', to: '_', enabled: false },
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

  it('adds a rule and persists the appended list', async () => {
    seed({ titleReplacements: rules })
    const { user } = renderWithProviders(<TitleReplacementSettings />)

    await user.click(
      screen.getByRole('button', {
        name: 'settings.title_replacement.add_rule',
      }),
    )

    const call = mockInvoke.mock.calls.find((c) => c[0] === 'patch_settings')
    expect(call?.[1]).toMatchObject({
      patch: {
        titleReplacements: [...rules, { from: '', to: '', enabled: true }],
      },
    })
  })

  it('toggles a rule enabled state', async () => {
    seed({ titleReplacements: rules })
    const { user } = renderWithProviders(<TitleReplacementSettings />)

    await user.click(within(rowOf('/')).getByRole('switch'))

    const call = mockInvoke.mock.calls.find((c) => c[0] === 'patch_settings')
    expect(call?.[1]).toMatchObject({
      patch: {
        titleReplacements: [
          { from: '/', to: '-', enabled: false },
          { from: ':', to: '_', enabled: false },
        ],
      },
    })
  })

  it('edits a rule from/to values and saves on OK', async () => {
    seed({ titleReplacements: rules })
    const { user } = renderWithProviders(<TitleReplacementSettings />)

    const row = rowOf('/')
    // Row action buttons in DOM order: [edit (Pencil), delete (Trash2)]
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
        titleReplacements: [
          { from: '?', to: 'x', enabled: true },
          { from: ':', to: '_', enabled: false },
        ],
      },
    })
  })

  it('deletes a rule', async () => {
    seed({ titleReplacements: rules })
    const { user } = renderWithProviders(<TitleReplacementSettings />)

    await user.click(within(rowOf(':')).getAllByRole('button')[1])

    const call = mockInvoke.mock.calls.find((c) => c[0] === 'patch_settings')
    expect(call?.[1]).toMatchObject({
      patch: { titleReplacements: [{ from: '/', to: '-', enabled: true }] },
    })
  })

  it('disables add and warns at MAX_RULES (20)', () => {
    seed({
      titleReplacements: Array.from({ length: 20 }, (_, i) => ({
        from: String(i),
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

  it('shows the empty-rules note when the user cleared all rules', () => {
    seed({ titleReplacements: [] })
    renderWithProviders(<TitleReplacementSettings />)

    expect(
      screen.getByText('settings.title_replacement.empty_rules_note'),
    ).toBeInTheDocument()
  })
})
