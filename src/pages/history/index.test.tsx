import HistoryPage from '@/pages/history'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('react-i18next', () => ({
  useTranslation: vi.fn(() => ({
    t: vi.fn((key) => key),
    i18n: {
      changeLanguage: vi.fn(),
      language: 'en',
    },
  })),
  I18nextProvider: ({ children }: { children: React.ReactNode }) => children,
}))

describe.skip('HistoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.skip('renders search input', () => {
    render(<HistoryPage />)
    const searchInput = screen.getByPlaceholderText(/search/i)
    expect(searchInput).toBeInTheDocument()
  })

  it.skip('renders filter dropdown', () => {
    render(<HistoryPage />)
    const filterButton = screen.getByRole('button', {
      name: /all|success|failed/i,
    })
    expect(filterButton).toBeInTheDocument()
  })

  it.skip('renders export button', () => {
    render(<HistoryPage />)
    const exportButton = screen.getByRole('button', {
      name: /export/i,
    })
    expect(exportButton).toBeInTheDocument()
  })

  it.skip('renders empty state when no entries', () => {
    render(<HistoryPage />)
    expect(screen.getByText(/no download history yet/i)).toBeInTheDocument()
  })
})
