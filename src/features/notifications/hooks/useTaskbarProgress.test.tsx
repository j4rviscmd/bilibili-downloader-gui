import { store } from '@/app/store'
import { error as logError } from '@tauri-apps/plugin-log'
import { useTaskbarProgress } from '@/features/notifications/hooks/useTaskbarProgress'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import { setProgress } from '@/shared/progress/progressSlice'
import { clearQueue, enqueue } from '@/shared/queue/queueSlice'
import { getCurrentWindow, ProgressBarStatus } from '@tauri-apps/api/window'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// setup.ts returns a single shared window instance, so this is the same
// vi.fn the hook invokes.
const mockSetProgressBar = getCurrentWindow()
  .setProgressBar as unknown as ReturnType<typeof vi.fn>

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

describe('useTaskbarProgress', () => {
  beforeEach(() => {
    store.dispatch(setSettings(baselineSettings))
    store.dispatch(clearQueue())
    mockSetProgressBar.mockClear()
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('clears the progress bar when no downloads are active', () => {
    renderHook(() => useTaskbarProgress(), { wrapper })
    expect(mockSetProgressBar).toHaveBeenCalledWith({
      status: ProgressBarStatus.None,
    })
  })

  it('shows the progress bar while a child download is running', () => {
    store.dispatch(
      enqueue({
        downloadId: 'parent-1-p1',
        parentId: 'parent-1',
        status: 'running',
      }),
    )
    renderHook(() => useTaskbarProgress(), { wrapper })
    // No progress entries yet, so overallRatio is 0, but the bar is shown.
    expect(mockSetProgressBar).toHaveBeenCalledWith({ progress: 0 })
  })

  it('reflects the computed overall ratio in the bar', () => {
    store.dispatch(
      enqueue({
        downloadId: 'parent-1-p1',
        parentId: 'parent-1',
        status: 'running',
      }),
    )
    store.dispatch(
      setProgress({
        downloadId: 'parent-1-p1',
        stage: 'audio',
        percentage: 50,
        deltaTime: 1,
        filesize: 10,
        downloaded: 5,
        transferRate: 100,
        elapsedTime: 1,
        isComplete: false,
      }),
    )
    renderHook(() => useTaskbarProgress(), { wrapper })
    expect(mockSetProgressBar).toHaveBeenCalledWith({ progress: 17 })
  })

  it('logs when setProgressBar rejects', async () => {
    mockSetProgressBar.mockRejectedValueOnce(new Error('window gone'))
    const { unmount } = renderHook(() => useTaskbarProgress(), { wrapper })
    unmount()

    // The rejection is routed to the mocked plugin-log error fn (global setup
    // mock). logger.error formats prefix+message+error into one string.
    await waitFor(() =>
      expect(logError).toHaveBeenCalledWith(
        '[FE] setProgressBar(clear) failed: Error: window gone',
      ),
    )
  })

  it('clears the bar when showTaskbarProgress is disabled', () => {
    store.dispatch(
      setSettings({ ...baselineSettings, showTaskbarProgress: false }),
    )
    store.dispatch(
      enqueue({
        downloadId: 'parent-1-p1',
        parentId: 'parent-1',
        status: 'running',
      }),
    )
    renderHook(() => useTaskbarProgress(), { wrapper })
    expect(mockSetProgressBar).toHaveBeenCalledWith({
      status: ProgressBarStatus.None,
    })
  })
})
