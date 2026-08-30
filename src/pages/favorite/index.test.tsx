import { store } from '@/app/store'
import type { FavoriteFolder, FavoriteVideo } from '@/features/favorite/types'
import { setUser } from '@/features/user/userSlice'
import FavoriteContent from '@/pages/favorite'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Feature leaves and the data hook are covered by their own tests; here
// they are stubbed so this file locks the page's wiring only.
vi.mock('@/features/favorite/hooks/useFavorite', () => ({
  useFavorite: vi.fn(),
  formatDuration: vi.fn(),
  formatPlayCount: vi.fn(),
}))
vi.mock('@/features/favorite/ui/FavoriteList', () => ({
  default: (props: {
    videos: unknown[]
    hasMore: boolean
    disabled: boolean
    onDownload: (v: unknown) => void
  }) => (
    <div>
      <div data-testid="fav-list">
        count={props.videos.length} hasMore={String(props.hasMore)} disabled=
        {String(props.disabled)}
      </div>
      <button onClick={() => props.onDownload(mockVideo)}>download</button>
    </div>
  ),
}))
vi.mock('@/features/favorite/ui/FolderSelector', () => ({
  default: (props: {
    folders: unknown[]
    selectedId: number | null
    loading: boolean
    onSelect: (id: number) => void
  }) => (
    <button onClick={() => props.onSelect(7)}>
      folder-selector:{props.folders.length}:{props.selectedId}:
      {String(props.loading)}
    </button>
  ),
}))
vi.mock('@/shared/ui/toast', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { useFavorite } from '@/features/favorite/hooks/useFavorite'
import { toast } from '@/shared/ui/toast'

/** A favorite video passed through the mocked list's onDownload. */
const mockVideo = {
  bvid: 'BV1fav',
  page: 2,
} as FavoriteVideo

const mockFolders = [{ id: 1, title: 'Default' }] as unknown as FavoriteFolder[]

function createMockUseFavorite(
  overrides: Partial<ReturnType<typeof useFavorite>> = {},
): ReturnType<typeof useFavorite> {
  return {
    folders: [],
    selectedFolderId: null,
    videos: [],
    hasMore: false,
    loading: false,
    foldersLoading: false,
    error: null,
    selectFolder: vi.fn(),
    loadMore: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  } as ReturnType<typeof useFavorite>
}

function seedLoggedIn(loggedIn: boolean) {
  store.dispatch(
    setUser({
      code: 0,
      message: '',
      ttl: 0,
      data: {
        uname: loggedIn ? 'tester' : '',
        isLogin: loggedIn,
        mid: loggedIn ? 42 : undefined,
        wbiImg: { imgUrl: '', subUrl: '' },
      },
      hasCookie: loggedIn,
    }),
  )
}

describe('FavoriteContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedLoggedIn(true)
    vi.mocked(useFavorite).mockReturnValue(createMockUseFavorite())
  })

  it('renders the login-required notice when logged out', () => {
    seedLoggedIn(false)

    renderWithProviders(<FavoriteContent />, { route: '/favorite' })

    expect(screen.getByText('favorite.loginRequired')).toBeInTheDocument()
    expect(vi.mocked(useFavorite)).not.toHaveBeenCalledWith(expect.anything())
  })

  it('passes the logged-in mid to useFavorite and sets the title', () => {
    renderWithProviders(<FavoriteContent />, { route: '/favorite' })

    expect(vi.mocked(useFavorite)).toHaveBeenCalledWith(42)
    expect(screen.getByText('favorite.title')).toBeInTheDocument()
    expect(document.title).toBe('favorite.title - app.title')
  })

  it('wires folder selector props and forwards folder selection', async () => {
    vi.mocked(useFavorite).mockReturnValue(
      createMockUseFavorite({
        folders: mockFolders,
        selectedFolderId: 1,
      }),
    )

    const { user } = renderWithProviders(<FavoriteContent />, {
      route: '/favorite',
    })

    expect(screen.getByText('folder-selector:1:1:false')).toBeInTheDocument()
    await user.click(screen.getByText(/folder-selector/))
    expect(
      vi.mocked(useFavorite).mock.results[0]!.value.selectFolder,
    ).toHaveBeenCalledWith(7)
  })

  it('wires list props from the hook', () => {
    vi.mocked(useFavorite).mockReturnValue(
      createMockUseFavorite({
        videos: [mockVideo, mockVideo, mockVideo],
        hasMore: true,
      }),
    )

    renderWithProviders(<FavoriteContent />, { route: '/favorite' })

    expect(screen.getByTestId('fav-list')).toHaveTextContent('count=3')
    expect(screen.getByTestId('fav-list')).toHaveTextContent('hasMore=true')
    expect(screen.getByTestId('fav-list')).toHaveTextContent('disabled=false')
  })

  it('disables refresh while loading or without a selected folder', async () => {
    const { user } = renderWithProviders(<FavoriteContent />, {
      route: '/favorite',
    })

    const refreshButton = screen
      .getByText('favorite.refresh')
      .closest('button')!
    expect(refreshButton).toBeDisabled()

    // A selected folder unlocks the button.
    const refresh = vi.fn()
    vi.mocked(useFavorite).mockReturnValue(
      createMockUseFavorite({ selectedFolderId: 1, refresh }),
    )
    // Re-render is driven by the hook mock changing; re-mount the page.
    // (Simplest reliable way with a module-level vi.fn hook mock.)
    renderWithProviders(<FavoriteContent />, { route: '/favorite' })
    const enabledButton = screen
      .getAllByText('favorite.refresh')
      .pop()!
      .closest('button')!
    expect(enabledButton).toBeEnabled()
    await user.click(enabledButton)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('favorite.refreshed')
  })

  it('onDownload stores a pending download with a null cid (favorites)', async () => {
    const { user } = renderWithProviders(<FavoriteContent />, {
      route: '/favorite',
    })

    await user.click(screen.getByText('download'))

    expect(store.getState().input.pendingDownload).toEqual({
      bvid: 'BV1fav',
      cid: null,
      page: 2,
    })
  })
})
