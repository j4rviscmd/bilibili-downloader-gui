/**
 * AboutSection suite: glue only — each maintenance action renders
 * (their behaviors have their own suites).
 */

import { renderWithProviders } from '@/test/test-utils'
import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/about', () => ({
  AboutDialog: () => <div data-testid="about-dialog" />,
}))
vi.mock('@/features/settings/ui/UpdateCheckButton', () => ({
  UpdateCheckButton: () => <div data-testid="update-check" />,
}))
vi.mock('@/features/settings/ui/ReleaseNotesSection', () => ({
  ReleaseNotesSection: () => <div data-testid="release-notes" />,
}))
vi.mock('@/features/settings/ui/OpenLogsButton', () => ({
  OpenLogsButton: () => <div data-testid="open-logs" />,
}))

import { AboutSection } from './AboutSection'

describe('AboutSection', () => {
  it('renders the four maintenance actions', () => {
    renderWithProviders(<AboutSection />)

    expect(screen.getByTestId('update-check')).toBeInTheDocument()
    expect(screen.getByTestId('release-notes')).toBeInTheDocument()
    expect(screen.getByTestId('about-dialog')).toBeInTheDocument()
    expect(screen.getByTestId('open-logs')).toBeInTheDocument()
  })
})
