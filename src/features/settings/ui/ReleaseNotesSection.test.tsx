/**
 * ReleaseNotesSection suite.
 *
 * Notes are fetched through the 'get_all_release_notes' invoke (the
 * updater api layer is real; only invoke is mocked). The dialog markup
 * renders via ReactMarkdown — assert on rendered heading/list nodes.
 *
 * CAUTION: motion's exit animations never complete under the happy-dom
 * WAAPI polyfill, so the dialog DOM stays mounted after close. Close
 * state is therefore asserted via the overlay's data-state instead of
 * DOM removal.
 */

import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ReleaseNotesSection } from './ReleaseNotesSection'

// Fixture exercises every markdown renderer: headings, lists, code, links,
// emphasis and blockquotes.
const NOTES = [
  '# Release Notes',
  '## Fixes',
  '### Downloads',
  '- Fixed download stall',
  '- Added CSV export',
  '1. First change',
  '2. Second change',
  'Run `npm run build` to verify:',
  '```',
  'const x = 1',
  '```',
  'See [the repo](https://github.com/j4rviscmd/bilibili-downloader-gui) for **details**.',
  '> Migrated from the legacy queue.',
].join('\n\n')

/** The Radix overlay reflects open state even while exit content lingers. */
function overlayState(): string | null | undefined {
  return document
    .querySelector('[data-slot="dialog-overlay"]')
    ?.getAttribute('data-state')
}

describe('ReleaseNotesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_all_release_notes') return Promise.resolve(NOTES)
      return Promise.resolve(undefined)
    })
  })

  it('fetches notes on first open and renders the markdown', async () => {
    const { user } = renderWithProviders(<ReleaseNotesSection />)

    await user.click(
      screen.getByRole('button', {
        name: 'settings.release_notes.button_aria',
      }),
    )

    expect(mockInvoke).toHaveBeenCalledWith('get_all_release_notes', {
      owner: 'j4rviscmd',
      repo: 'bilibili-downloader-gui',
    })
    expect(
      await screen.findByRole('heading', { name: 'Release Notes' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Fixed download stall')).toBeInTheDocument()
    expect(screen.getByText('Added CSV export')).toBeInTheDocument()
  })

  it('closes via the dialog close button', async () => {
    const { user } = renderWithProviders(<ReleaseNotesSection />)

    await user.click(
      screen.getByRole('button', {
        name: 'settings.release_notes.button_aria',
      }),
    )
    await screen.findByRole('heading', { name: 'Release Notes' })
    expect(overlayState()).toBe('open')

    await user.click(screen.getByRole('button', { name: /close/i }))

    await vi.waitFor(() => expect(overlayState()).toBe('closed'))
  })

  it('reuses the cached notes without refetching on the second open', async () => {
    const { user } = renderWithProviders(<ReleaseNotesSection />)

    await user.click(
      screen.getByRole('button', {
        name: 'settings.release_notes.button_aria',
      }),
    )
    await screen.findByRole('heading', { name: 'Release Notes' })
    await user.click(screen.getByRole('button', { name: /close/i }))
    await vi.waitFor(() => expect(overlayState()).toBe('closed'))

    await user.click(
      // The closed dialog's exit content lingers (see file comment) and keeps
      // aria-hidden on the rest of the page, so query with hidden: true.
      screen.getByRole('button', {
        name: 'settings.release_notes.button_aria',
        hidden: true,
      }),
    )

    // Cached path: setOpen(true) without a second fetch.
    await vi.waitFor(() => expect(overlayState()).toBe('open'))
    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })

  it('shows the error message when the fetch fails', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('github down'))
    const { user } = renderWithProviders(<ReleaseNotesSection />)

    await user.click(
      screen.getByRole('button', {
        name: 'settings.release_notes.button_aria',
      }),
    )

    expect(
      await screen.findByText('settings.release_notes.error'),
    ).toBeInTheDocument()
  })
})
