/**
 * toast + Toaster suite.
 *
 * Drives the real react-toastify container: the toast wrapper's option
 * translation (duration/id) is asserted via spies on the react-toastify
 * `toast` object, and ToastBody (title/description/action/Copy) is asserted
 * through the rendered DOM inside <Toaster />.
 */

import { renderWithProviders } from '@/test/test-utils'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { toast as baseToast } from 'react-toastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { toast } from './toast'
import { Toaster as ToasterFromToaster } from './toaster'

const successSpy = vi.spyOn(baseToast, 'success')
const errorSpy = vi.spyOn(baseToast, 'error')
const infoSpy = vi.spyOn(baseToast, 'info')
const dismissSpy = vi.spyOn(baseToast, 'dismiss')

beforeEach(() => {
  successSpy.mockClear()
  errorSpy.mockClear()
  dismissSpy.mockClear()
})

afterEach(() => {
  baseToast.dismiss()
})

describe('toast wrapper option translation', () => {
  it('forwards success to react-toastify with autoClose and toastId', () => {
    toast.success('Saved', { duration: 5000, id: 'save-1' })

    expect(successSpy).toHaveBeenCalledTimes(1)
    const options = successSpy.mock.calls[0]![1]
    expect(options).toMatchObject({ autoClose: 5000, toastId: 'save-1' })
  })

  it('maps duration: false to autoClose: false (sticky toast)', () => {
    toast.error('Failed', { duration: false })

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0]![1]).toMatchObject({ autoClose: false })
  })

  it('leaves autoClose undefined when no duration is given', () => {
    toast.info('Hello')

    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(infoSpy.mock.calls[0]![1]!.autoClose).toBeUndefined()
  })

  it('dismiss proxies to react-toastify dismiss', () => {
    toast.dismiss('abc')

    expect(dismissSpy).toHaveBeenCalledWith('abc')
  })
})

describe('Toaster + ToastBody rendering', () => {
  it('renders the toast body with title, description and Copy button', async () => {
    renderWithProviders(<ToasterFromToaster />)

    toast.error('Download failed', { description: 'ERR::NETWORK::boom' })

    expect(await screen.findByText('Download failed')).toBeInTheDocument()
    expect(screen.getByText('ERR::NETWORK::boom')).toBeInTheDocument()
    // Copy button is labeled through i18n (identity t -> key).
    expect(
      screen.getByRole('button', { name: 'common.copy' }),
    ).toBeInTheDocument()
  })

  it('hides the Copy button when nothing is copyable', async () => {
    renderWithProviders(<ToasterFromToaster />)

    // A ReactNode title without a string description yields no copy text.
    toast.info(<em>rich title</em>)

    expect(await screen.findByText('rich title')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.copy' })).toBeNull()
  })

  it('omits empty descriptions', async () => {
    renderWithProviders(<ToasterFromToaster />)

    toast.warning('Warned', { description: '' })

    expect(await screen.findByText('Warned')).toBeInTheDocument()
    // The empty description renders no element of its own.
    expect(document.querySelectorAll('.text-sm.opacity-80')).toHaveLength(0)
  })

  it('copies title + description to the clipboard from the Copy button', async () => {
    renderWithProviders(<ToasterFromToaster />)

    toast.success('Copied title', { description: 'detail line' })
    const copy = await screen.findByRole('button', { name: 'common.copy' })

    // fireEvent instead of userEvent: user-event's setup() swaps in its own
    // navigator.clipboard stub. happy-dom's real clipboard stores the text,
    // so assert through readText.
    fireEvent.click(copy)

    // buildCopyText joins title and description with a newline.
    await expect(navigator.clipboard.readText()).resolves.toBe(
      'Copied title\ndetail line',
    )
  })

  it('renders and invokes the action button', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    renderWithProviders(<ToasterFromToaster />)

    toast.success('Converted', {
      action: { label: 'Open folder', onClick },
    })

    await user.click(await screen.findByRole('button', { name: 'Open folder' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('dismisses a sticky toast by id', async () => {
    renderWithProviders(<ToasterFromToaster />)

    toast.error('Sticky', { duration: false, id: 'sticky-1' })
    expect(await screen.findByText('Sticky')).toBeInTheDocument()
    expect(baseToast.isActive('sticky-1')).toBe(true)

    toast.dismiss('sticky-1')

    // happy-dom never fires the CSS exit transition, so assert through
    // react-toastify's own active registry instead of DOM removal.
    await waitFor(() => expect(baseToast.isActive('sticky-1')).toBe(false))
  })
})

describe('Toaster theme mapping', () => {
  // react-toastify v11 carries the theme as a per-toast CSS class, so the
  // mapping is asserted on a rendered toast rather than the section root.
  it('maps richColors to the colored theme', async () => {
    renderWithProviders(<ToasterFromToaster richColors />)

    toast.info('Colored')

    const el = await screen.findByText('Colored')
    expect(el.closest('.Toastify__toast')).toHaveClass(
      'Toastify__toast-theme--colored',
    )
  })

  it('applies the requested theme when richColors is off', async () => {
    renderWithProviders(<ToasterFromToaster theme="dark" />)

    toast.info('Dark')

    const el = await screen.findByText('Dark')
    expect(el.closest('.Toastify__toast')).toHaveClass(
      'Toastify__toast-theme--dark',
    )
  })

  it('falls back to the light theme by default', async () => {
    renderWithProviders(<ToasterFromToaster />)

    toast.info('Light')

    const el = await screen.findByText('Light')
    expect(el.closest('.Toastify__toast')).toHaveClass(
      'Toastify__toast-theme--light',
    )
  })
})
