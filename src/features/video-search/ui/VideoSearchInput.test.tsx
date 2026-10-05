import { renderWithProviders } from '@/test/test-utils'
import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchSuggestApi } from '../api/searchSuggest'
import { VideoSearchInput } from './VideoSearchInput'

vi.mock('../api/searchSuggest', () => ({
  searchSuggestApi: vi.fn(),
}))

const PLACEHOLDER = 'videoSearch.placeholder'

function setup(onSearch = vi.fn()) {
  return {
    onSearch,
    ...renderWithProviders(
      <VideoSearchInput onSearch={onSearch} loading={false} />,
    ),
  }
}

async function typeAndSuggest(
  user: Awaited<ReturnType<typeof setup>['user']>,
  text: string,
) {
  vi.mocked(searchSuggestApi).mockResolvedValue(['少年', '少年法'])
  await user.type(screen.getByRole('combobox', { name: PLACEHOLDER }), text)
  await act(async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
  })
}
describe('VideoSearchInput suggestions', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('fetches suggestions after the debounce and renders the listbox', async () => {
    const { user } = setup()
    await typeAndSuggest(user, '少年')

    expect(searchSuggestApi).toHaveBeenCalledWith('少年')
    const input = screen.getByRole('combobox', { name: PLACEHOLDER })
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '少年法' })).toBeInTheDocument()
  })

  it('does not fetch for blank drafts', async () => {
    const { user } = setup()
    await user.type(screen.getByRole('combobox', { name: PLACEHOLDER }), '   ')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(searchSuggestApi).not.toHaveBeenCalled()
  })

  it('navigates with arrows and Enter picks the active suggestion', async () => {
    const onSearch = vi.fn()
    const { user } = setup(onSearch)
    await typeAndSuggest(user, '少年')

    const input = screen.getByRole('combobox', { name: PLACEHOLDER })
    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant')
    await user.keyboard('{Enter}')

    expect(onSearch).toHaveBeenCalledWith('少年')
    expect(input).toHaveValue('少年')
  })

  it('clicking an option searches it and fills the input', async () => {
    const onSearch = vi.fn()
    const { user } = setup(onSearch)
    await typeAndSuggest(user, '少年')

    await user.click(screen.getByRole('option', { name: '少年法' }))
    expect(onSearch).toHaveBeenCalledWith('少年法')
    expect(screen.getByRole('combobox', { name: PLACEHOLDER })).toHaveValue(
      '少年法',
    )
  })

  it('clicking an option does not re-suggest the committed keyword', async () => {
    const { user } = setup()
    await typeAndSuggest(user, '少年')

    vi.mocked(searchSuggestApi).mockClear()
    await user.click(screen.getByRole('option', { name: '少年法' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(searchSuggestApi).not.toHaveBeenCalled()
    const input = screen.getByRole('combobox', { name: PLACEHOLDER })
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('Enter-picking a suggestion does not re-suggest it', async () => {
    const { user } = setup()
    await typeAndSuggest(user, '少年')

    vi.mocked(searchSuggestApi).mockClear()
    await user.keyboard('{ArrowDown}{Enter}')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(searchSuggestApi).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('focusing the input re-suggests for the current value', async () => {
    const { user } = setup()
    await typeAndSuggest(user, '少年')
    await user.click(screen.getByRole('option', { name: '少年法' }))
    // Leave the input, then come back: the list must reappear for the
    // committed keyword.
    await user.click(document.body)
    vi.mocked(searchSuggestApi).mockClear()
    vi.mocked(searchSuggestApi).mockResolvedValue(['少年法 ライブ'])
    await user.click(screen.getByRole('combobox', { name: PLACEHOLDER }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(searchSuggestApi).toHaveBeenCalledWith('少年法')
    expect(
      screen.getByRole('option', { name: '少年法 ライブ' }),
    ).toBeInTheDocument()
  })

  it('blurs the input when a search fires', async () => {
    const { user } = setup()
    await typeAndSuggest(user, '少年')

    await user.keyboard('{Enter}')
    expect(
      screen.getByRole('combobox', { name: PLACEHOLDER }),
    ).not.toHaveFocus()
  })

  it('Enter without an active option submits the raw draft', async () => {
    const onSearch = vi.fn()
    const { user } = setup(onSearch)
    await typeAndSuggest(user, '少年')

    await user.keyboard('{Enter}')
    expect(onSearch).toHaveBeenCalledWith('少年')
  })

  it('Escape closes the dropdown without searching', async () => {
    const onSearch = vi.fn()
    const { user } = setup(onSearch)
    await typeAndSuggest(user, '少年')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onSearch).not.toHaveBeenCalled()
  })

  it('ignores stale suggest responses', async () => {
    const { user } = setup()
    const input = screen.getByRole('combobox', { name: PLACEHOLDER })

    // Deferred manual promise: Promise.withResolvers needs lib es2024 and
    // the repo targets ES2022.
    let resolveFirst!: (v: string[]) => void
    vi.mocked(searchSuggestApi)
      .mockReturnValueOnce(
        new Promise<string[]>((r) => {
          resolveFirst = r
        }),
      )
      .mockResolvedValue(['新しい候補'])
    await user.type(input, 'a')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    await user.type(input, 'b')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    // The first (stale) response lands after the second one: it must be
    // discarded, not clobber the fresh list.
    resolveFirst(['古い候補'])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(
      screen.getByRole('option', { name: '新しい候補' }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('option', { name: '古い候補' }),
    ).not.toBeInTheDocument()
  })

  it('discards in-flight suggestions when the input clears', async () => {
    const { user } = setup()
    const input = screen.getByRole('combobox', { name: PLACEHOLDER })

    // Deferred manual promise: Promise.withResolvers needs lib es2024 and
    // the repo targets ES2022.
    let resolveFirst!: (v: string[]) => void
    vi.mocked(searchSuggestApi)
      .mockReturnValueOnce(
        new Promise<string[]>((r) => {
          resolveFirst = r
        }),
      )
      .mockResolvedValue([])
    await user.type(input, 'a')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    await user.clear(input)
    // The response for "a" lands after the input cleared: it must not
    // re-open the listbox over an empty input.
    resolveFirst(['古い候補'])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
