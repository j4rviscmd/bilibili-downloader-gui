import { LoginPage } from '@/pages/login'
import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// The page is a thin wrapper: it must mount QRCodeDisplay (whose QR/polling
// logic is covered by its own feature tests) inside the login card.
vi.mock('@/features/login', () => ({
  QRCodeDisplay: () => <div data-testid="qr-code-display" />,
  QRCodeLoginDialog: () => <div data-testid="qr-login-dialog" />,
}))

describe('LoginPage', () => {
  it('renders QRCodeDisplay inside the login card', () => {
    renderWithProviders(<LoginPage />, { route: '/login' })

    expect(screen.getByTestId('qr-code-display')).toBeInTheDocument()
  })

  it('renders the card title via i18n', () => {
    renderWithProviders(<LoginPage />, { route: '/login' })

    expect(screen.getByText('login.title')).toBeInTheDocument()
  })
})
