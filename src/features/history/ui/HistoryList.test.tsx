/**
 * HistoryList suite.
 *
 * Loading/empty states render synchronously. The populated path goes
 * through react-virtuoso, which cannot compute a viewport under
 * happy-dom (zero-sized rects, no layout engine), so items never
 * materialize — the populated test only locks in that the Virtuoso
 * scroller mounts. Per-entry rendering/actions are covered by
 * HistoryItem.test.tsx.
 */

import type { HistoryEntry } from '@/features/history/model/historySlice'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import HistoryList from './HistoryList'

const entry: HistoryEntry = {
  id: '1',
  title: 'A downloaded video',
  url: 'https://www.bilibili.com/video/BV1xx',
  downloadedAt: new Date().toISOString(),
  status: 'completed',
}

beforeAll(() => {
  // happy-dom ships no ResizeObserver; react-virtuoso requires one.
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
})

describe('HistoryList', () => {
  it('shows the loading state while fetching', () => {
    renderWithProviders(<HistoryList entries={[]} loading onDelete={vi.fn()} />)

    expect(screen.getByText('init.initializing')).toBeInTheDocument()
  })

  it('shows the empty state when there are no entries', () => {
    renderWithProviders(
      <HistoryList entries={[]} loading={false} onDelete={vi.fn()} />,
    )

    expect(screen.getByText('history.empty')).toBeInTheDocument()
  })

  it('mounts the virtualized scroller when entries exist', () => {
    renderWithProviders(
      <HistoryList entries={[entry]} loading={false} onDelete={vi.fn()} />,
    )

    expect(
      document.querySelector('[data-virtuoso-scroller]'),
    ).toBeInTheDocument()
  })
})
