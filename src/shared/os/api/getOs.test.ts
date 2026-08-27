import { mockInvoke } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `cached` is module-scoped, so each test re-imports a fresh module via
// `vi.resetModules()` + dynamic import to control the cache lifetime.
async function importGetOs() {
  vi.resetModules()
  return import('./getOs')
}

describe('getOs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('should call invoke with get_os command and return the raw value', async () => {
    mockInvoke.mockResolvedValue('macos')
    const { getOs } = await importGetOs()

    const result = await getOs()

    expect(mockInvoke).toHaveBeenCalledWith('get_os')
    expect(result).toBe('macos')
  })

  it.each([
    'windows',
    'linux',
    'android',
    'ios',
    'freebsd',
    'dragonfly',
    'netbsd',
    'openbsd',
    'solaris',
    'unknown',
  ] as const)('should pass through known OS %s', async (os) => {
    mockInvoke.mockResolvedValue(os)
    const { getOs } = await importGetOs()

    await expect(getOs()).resolves.toBe(os)
  })

  it('should normalize unexpected backend values to unknown', async () => {
    mockInvoke.mockResolvedValue('Windows_NT')
    const { getOs } = await importGetOs()

    await expect(getOs()).resolves.toBe('unknown')
  })

  it('should return unknown when invoke rejects', async () => {
    mockInvoke.mockRejectedValue(new Error('IPC failure'))
    const { getOs } = await importGetOs()

    await expect(getOs()).resolves.toBe('unknown')
  })

  it('should cache the result and skip invoke on subsequent calls', async () => {
    mockInvoke.mockResolvedValue('windows')
    const { getOs } = await importGetOs()

    await getOs()
    await getOs()

    expect(mockInvoke).toHaveBeenCalledTimes(1)
  })
})
