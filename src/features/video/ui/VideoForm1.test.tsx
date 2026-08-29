import { store } from '@/app/store'
import { useVideoInfo } from '@/features/video'
import { setInput } from '@/features/video/model/inputSlice'
import { clearQueue } from '@/shared/queue'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import VideoForm1 from './VideoForm1'

// The context hook is covered by its own tests; mock it so this suite
// drives the URL form directly. Validation rules live in formSchema.test.
vi.mock('@/features/video', () => ({
  useVideoInfo: vi.fn(),
}))
vi.mock('@/features/video/api/expandShortUrl', () => ({
  expandShortUrl: vi.fn(),
}))

const VALID_URL = 'https://www.bilibili.com/video/BV1xx411c7XD'

/** Renders the form with a fresh store input and a spied onValid1. */
function setup(isFetching = false) {
  const onValid1 = vi.fn()
  store.dispatch(
    setInput({ url: '', partInputs: [], pendingDownload: null, homePage: 1 }),
  )
  vi.mocked(useVideoInfo).mockReturnValue({
    input: store.getState().input,
    onValid1,
    isFetching,
  } as unknown as ReturnType<typeof useVideoInfo>)
  return { ...renderWithProviders(<VideoForm1 />), onValid1 }
}

describe('VideoForm1', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.dispatch(clearQueue())
  })

  it('renders the URL input with its example placeholder', () => {
    setup()

    expect(
      screen.getByPlaceholderText('video.url_placeholder_example'),
    ).toBeInTheDocument()
  })

  it('submits a valid URL to onValid1', async () => {
    const { user: actor, onValid1 } = setup()

    const input = screen.getByPlaceholderText('video.url_placeholder_example')
    await actor.type(input, `${VALID_URL}{Enter}`)

    expect(onValid1).toHaveBeenCalledTimes(1)
    expect(onValid1).toHaveBeenCalledWith(VALID_URL)
  })

  it('rejects a non-bilibili domain with an inline error and no fetch', async () => {
    const { user: actor, onValid1 } = setup()

    const input = screen.getByPlaceholderText('video.url_placeholder_example')
    await actor.type(input, 'https://example.com/video/x{Enter}')

    expect(onValid1).not.toHaveBeenCalled()
    expect(screen.getByText('validation.video.url.domain')).toBeInTheDocument()
  })

  it('disables the input while video info is fetching', () => {
    setup(true)

    expect(
      screen.getByPlaceholderText('video.url_placeholder_example'),
    ).toBeDisabled()
  })

  it('clears the input via the clear button', async () => {
    const { user: actor } = setup()

    const input = screen.getByPlaceholderText(
      'video.url_placeholder_example',
    ) as HTMLInputElement
    await actor.type(input, VALID_URL)
    expect(input.value).toBe(VALID_URL)

    // The clear control is the only icon-only button in the field
    await actor.click(screen.getByRole('button'))
    expect(input.value).toBe('')
  })

  it('resubmits the same URL after clearing', async () => {
    const { user: actor, onValid1 } = setup()
    const input = screen.getByPlaceholderText('video.url_placeholder_example')

    await actor.type(input, `${VALID_URL}{Enter}`)
    expect(onValid1).toHaveBeenCalledTimes(1)

    await actor.click(screen.getByRole('button'))
    await actor.type(input, VALID_URL)
    await actor.click(document.body)

    // lastFetchedUrl was reset by clear, so the resubmission is not skipped
    expect(onValid1).toHaveBeenCalledTimes(2)
  })
})
