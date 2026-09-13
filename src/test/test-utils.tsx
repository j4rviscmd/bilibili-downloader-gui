/**
 * Shared render utilities for component/hook tests.
 *
 * Conventions established by the existing best-in-repo tests
 * (useDownloadCompletionNotifications / useFontSizeShortcuts):
 * - the REAL singleton store from `@/app/store` is used, seeded via
 *   `store.dispatch(...)` and asserted via `store.getState()`
 * - MemoryRouter is always on: 5 non-page files (shared layouts,
 *   NavigationSidebarHeader, usePendingDownload, QRCodeDisplay) call
 *   useNavigate/useLocation, so conditional routing is a
 *   flag nobody would remember to set
 */

import { invoke } from '@tauri-apps/api/core'
import { render, renderHook } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import type { Mock } from 'vitest'

import { store } from '@/app/store'
import type { PartDownloadStatus } from '@/features/video/ui/PartDownloadProgress'
import {
  enqueueSession,
  removeQueueItems,
  updateQueueStatus,
  type EnqueuePartSpec,
  type QueueItemStatus,
} from '@/shared/queue'

/** The single `vi.fn` created by src/test/setup.ts — re-exported for ergonomics. */
export const mockInvoke = invoke as unknown as Mock

/**
 * Empties the singleton store's download queue (successor of the abolished
 * clearQueue action — the queue is session-scoped since issue #691).
 */
export function resetQueue() {
  const ids = store.getState().queue.map((i) => i.downloadId)
  if (ids.length > 0) store.dispatch(removeQueueItems(ids))
}

/**
 * Seeds one download session through the real enqueueSession reducer and
 * returns the parent downloadId. Statuses beyond 'pending' are applied via
 * updateQueueStatus so parent aggregation runs like production.
 */
export function seedSession(
  videoId: string,
  parts: { partIndex: number; cid: number; status?: QueueItemStatus }[],
): string {
  const specs: EnqueuePartSpec[] = parts.map((p) => ({
    partIndex: p.partIndex,
    cid: p.cid,
    title: `P${p.partIndex}`,
    thumbnailUrl: null,
    expectedStages: { audioStage: true, mergeStage: true },
    payload: {
      videoId,
      cid: p.cid,
      filename: `P${p.partIndex}`,
      quality: null,
      audioQuality: null,
      durationSeconds: 60,
      thumbnailUrl: null,
      page: p.partIndex,
      epId: null,
      subtitle: null,
    },
  }))
  store.dispatch(enqueueSession({ videoId, videoTitle: videoId, parts: specs }))
  const parents = store
    .getState()
    .queue.filter((i) => i.kind === 'parent' && i.videoId === videoId)
  const parentId = parents[parents.length - 1].downloadId
  for (const p of parts) {
    if (p.status && p.status !== 'pending') {
      store.dispatch(
        updateQueueStatus({
          downloadId: `${parentId}-p${p.partIndex}`,
          status: p.status,
        }),
      )
    }
  }
  return parentId
}

/** Builds an idle PartDownloadStatus with per-test overrides. */
export function createPartDownloadStatus(
  overrides: Partial<PartDownloadStatus> = {},
): PartDownloadStatus {
  return {
    downloadId: undefined,
    status: undefined,
    errorMessage: undefined,
    outputPath: undefined,
    filename: undefined,
    progressEntries: [],
    isComplete: false,
    isDownloading: false,
    isPending: false,
    hasError: false,
    isCancelling: false,
    isCancelled: false,
    ...overrides,
  }
}

/** Wrapper for `renderHook` against the real singleton store. */
export function storeWrapper({ children }: { children: ReactNode }) {
  return <Provider store={store}>{children}</Provider>
}

/** `renderHook` + the real store, returned together for dispatch/assert. */
export function renderHookWithStore<T>(callback: () => T) {
  return { ...renderHook(callback, { wrapper: storeWrapper }), store }
}

type RenderOptions = { route?: string }

/**
 * Render with the real store + MemoryRouter. Returns `user` pre-configured
 * (userEvent.setup) for interaction tests.
 */
export function renderWithProviders(
  ui: ReactElement,
  { route = '/' }: RenderOptions = {},
) {
  return {
    ...render(
      <Provider store={store}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </Provider>,
    ),
    store,
    user: userEvent.setup(),
  }
}

// Re-export the Tauri event helpers so a single import covers the toolkit.
export { clearTauriEvents, emitTauriEvent } from './tauriEvents'
