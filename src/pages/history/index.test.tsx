import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import HistoryPage from '@/pages/history'

vi.mock('@/features/history/hooks/useHistory', () => ({
  useHistory: vi.fn(() => ({
    entries: [],
    loading: false,
    error: null,
    filters: {},
    searchQuery: '',
    remove: vi.fn(),
    clear: vi.fn(),
    setSearch: vi.fn(),
    updateFilters: vi.fn(),
    exportData: vi.fn(),
  })),
}))

vi.mock('react-router', () => ({
  useNavigate: vi.fn(() => vi.fn()),
}))

describe('HistoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.document = {
      title: 'Mock',
    } as unknown as Document
  })

  it('renders page title correctly', () => {
    render(<HistoryPage />)
    expect(document.title).toContain('History')
  })

  it('renders search input', () => {
    render(<HistoryPage />)
    const searchInput = screen.getByPlaceholderText(/search/i)
    expect(searchInput).toBeInTheDocument()
  })

  it('renders filter dropdown', () => {
    render(<HistoryPage />)
    const filterButton = screen.getByRole('button', {
      name: /all|success|failed/i,
    })
    expect(filterButton).toBeInTheDocument()
  })

  it('renders export button', () => {
    render(<HistoryPage />)
    const exportButton = screen.getByRole('button', {
      name: /export/i,
    })
    expect(exportButton).toBeInTheDocument()
  })

  it('renders empty state when no entries', () => {
    render(<HistoryPage />)
    expect(screen.getByText(/no download history yet/i)).toBeInTheDocument()
  })
})

