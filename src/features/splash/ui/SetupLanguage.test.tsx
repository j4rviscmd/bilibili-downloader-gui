import { mockInvoke, renderWithProviders } from '@/test/test-utils'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { detectSetupLanguage } from '../lib/setup-language'
import { SetupLanguage } from './SetupLanguage'

describe('first-run language selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(undefined)
  })

  it('matches regional locales in preference order', () => {
    expect(detectSetupLanguage(['zh-CN', 'en-US'])).toBe('zh')
    expect(detectSetupLanguage(['de-DE', 'ja-JP'])).toBe('ja')
    expect(detectSetupLanguage(['KO_kr'])).toBe('ko')
    expect(detectSetupLanguage(['de-DE'])).toBe('en')
  })

  it('waits for the selected language to be persisted before starting setup', async () => {
    let save: (() => void) | undefined
    mockInvoke.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          save = resolve
        }),
    )
    const complete = vi.fn()
    renderWithProviders(<SetupLanguage onComplete={complete} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zh' } })
    fireEvent.click(screen.getByRole('button'))
    expect(mockInvoke).toHaveBeenCalledWith('patch_settings', {
      patch: { language: 'zh' },
    })
    expect(complete).not.toHaveBeenCalled()
    expect(screen.getByRole('button')).toBeDisabled()
    save?.()
    await waitFor(() => expect(complete).toHaveBeenCalledOnce())
  })

  it('shows a save error and keeps setup paused', async () => {
    mockInvoke.mockRejectedValue(new Error('disk full'))
    const complete = vi.fn()
    renderWithProviders(<SetupLanguage onComplete={complete} />)
    fireEvent.click(screen.getByRole('button'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'init.language_save_failed',
    )
    expect(complete).not.toHaveBeenCalled()
    expect(screen.getByRole('button')).toBeEnabled()
  })
})
