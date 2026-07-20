import { store } from '@/app/store'
import { useDownloadCompletionNotifications } from '@/features/notifications/hooks/useDownloadCompletionNotifications'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import {
  clearQueue,
  enqueue,
  updateQueueStatus,
} from '@/shared/queue/queueSlice'
import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const mockRequestUserAttention = getCurrentWindow()
  .requestUserAttention as unknown as ReturnType<typeof vi.fn>

const baselineSettings: Settings = {
  dlOutputPath: '',
  language: 'en',
  autoRenameDuplicates: true,
  showGithubStars: true,
  fontSize: 14,
  trimMode: 'copy',
  audioFormat: 'mp3',
  theme: 'light',
  showTaskbarProgress: true,
  flashTaskbarOnComplete: true,
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <Provider store={store}>{children}</Provider>
)

function seedRunning() {
  store.dispatch(
    enqueue({ downloadId: 'child-1', parentId: 'parent-1', status: 'running' }),
  )
}

describe('useDownloadCompletionNotifications', () => {
  beforeEach(() => {
    store.dispatch(setSettings(baselineSettings))
    store.dispatch(clearQueue())
    mockRequestUserAttention.mockClear()
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('flashes Informational on active → settled with success', async () => {
    seedRunning()
    renderHook(() => useDownloadCompletionNotifications(), { wrapper })
    store.dispatch(updateQueueStatus({ downloadId: 'child-1', status: 'done' }))
    await waitFor(() => {
      expect(mockRequestUserAttention).toHaveBeenCalledWith(
        UserAttentionType.Informational,
      )
    })
  })

  it('flashes Critical when a part errored', async () => {
    seedRunning()
    renderHook(() => useDownloadCompletionNotifications(), { wrapper })
    store.dispatch(
      updateQueueStatus({ downloadId: 'child-1', status: 'error' }),
    )
    await waitFor(() => {
      expect(mockRequestUserAttention).toHaveBeenCalledWith(
        UserAttentionType.Critical,
      )
    })
  })

  it('does NOT flash when all parts are cancelled', async () => {
    seedRunning()
    renderHook(() => useDownloadCompletionNotifications(), { wrapper })
    store.dispatch(
      updateQueueStatus({ downloadId: 'child-1', status: 'cancelled' }),
    )
    await waitFor(() => {
      expect(store.getState().queue[0]?.status).toBe('cancelled')
    })
    expect(mockRequestUserAttention).not.toHaveBeenCalled()
  })

  it('does NOT flash when flashTaskbarOnComplete is disabled', async () => {
    store.dispatch(
      setSettings({ ...baselineSettings, flashTaskbarOnComplete: false }),
    )
    seedRunning()
    renderHook(() => useDownloadCompletionNotifications(), { wrapper })
    store.dispatch(updateQueueStatus({ downloadId: 'child-1', status: 'done' }))
    await waitFor(() => {
      expect(store.getState().queue[0]?.status).toBe('done')
    })
    expect(mockRequestUserAttention).not.toHaveBeenCalled()
  })
})
