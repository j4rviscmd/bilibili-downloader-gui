import { store } from '@/app/store'
import { useTaskbarProgress } from '@/features/notifications/hooks/useTaskbarProgress'
import { setSettings } from '@/features/settings/settingsSlice'
import type { Settings } from '@/features/settings/type'
import { clearQueue, enqueue } from '@/shared/queue/queueSlice'
import { getCurrentWindow, ProgressBarStatus } from '@tauri-apps/api/window'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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
        downloadId: 'child-1',
        parentId: 'parent-1',
        status: 'running',
      }),
    )
    renderHook(() => useTaskbarProgress(), { wrapper })
    // No progress entries yet, so overallRatio is 0, but the bar is shown.
    expect(mockSetProgressBar).toHaveBeenCalledWith({ progress: 0 })
  })

  it('clears the bar when showTaskbarProgress is disabled', () => {
    store.dispatch(
      setSettings({ ...baselineSettings, showTaskbarProgress: false }),
    )
    store.dispatch(
      enqueue({
        downloadId: 'child-1',
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
