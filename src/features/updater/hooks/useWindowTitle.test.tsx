/**
 * useWindowTitle suite.
 *
 * The app version comes from '@tauri-apps/api/app' (mocked locally — setup.ts
 * does not own that module); getCurrentWindow().setTitle is the shared
 * mockCurrentWindow vi.fn from src/test/setup.ts.
 */

import { store } from '@/app/store'
import { useWindowTitle } from '@/features/updater/hooks/useWindowTitle'
import {
  resetUpdater,
  setUpdateAvailable,
} from '@/features/updater/model/updaterSlice'
import { renderHookWithStore } from '@/test/test-utils'
import { getVersion } from '@tauri-apps/api/app'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { waitFor } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn().mockResolvedValue('1.2.3'),
}))

const mockGetVersion = getVersion as unknown as Mock
// setup.ts returns a single shared window instance, so this is the same
// vi.fn the hook invokes.
const mockSetTitle = getCurrentWindow().setTitle as unknown as Mock

beforeEach(() => {
  vi.clearAllMocks()
  mockGetVersion.mockResolvedValue('1.2.3')
  store.dispatch(resetUpdater())
})

describe('useWindowTitle', () => {
  it('never calls setTitle while no update is available', async () => {
    const { rerender } = renderHookWithStore(() => useWindowTitle())

    await waitFor(() => expect(mockGetVersion).toHaveBeenCalled())
    // Latest / dev mode / check failure: the backend-composed base title
    // stands untouched — no IPC call.
    expect(mockSetTitle).not.toHaveBeenCalled()

    rerender()
    expect(mockSetTitle).not.toHaveBeenCalled()
  })

  it('appends the (update available) suffix when an update exists', async () => {
    store.dispatch(
      setUpdateAvailable({
        available: true,
        latestVersion: '2.0.0',
        currentVersion: '1.2.3',
      }),
    )
    renderHookWithStore(() => useWindowTitle())

    await waitFor(() => expect(mockSetTitle).toHaveBeenCalled())
    expect(mockSetTitle).toHaveBeenCalledWith(
      'Bilibili Downloader v1.2.3 (update available)',
    )
  })

  it('reacts to an update becoming available after mount', async () => {
    renderHookWithStore(() => useWindowTitle())

    store.dispatch(
      setUpdateAvailable({
        available: true,
        latestVersion: '2.0.0',
        currentVersion: '1.2.3',
      }),
    )
    await waitFor(() => expect(mockSetTitle).toHaveBeenCalled())
    expect(mockSetTitle).toHaveBeenLastCalledWith(
      'Bilibili Downloader v1.2.3 (update available)',
    )
  })

  it('never calls setTitle when getVersion rejects', async () => {
    mockGetVersion.mockRejectedValue(new Error('no app'))
    renderHookWithStore(() => useWindowTitle())

    store.dispatch(
      setUpdateAvailable({
        available: true,
        latestVersion: '2.0.0',
        currentVersion: '1.2.3',
      }),
    )
    // Give the rejected promise a tick to settle; no title write happens.
    await waitFor(() => expect(mockGetVersion).toHaveBeenCalledTimes(1))
    expect(mockSetTitle).not.toHaveBeenCalled()
  })
})
