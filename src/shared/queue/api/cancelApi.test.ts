import { mockInvoke } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callCancelDownload } from './cancelApi'

describe('callCancelDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call invoke with cancel_download command and downloadId', async () => {
    mockInvoke.mockResolvedValue(true)

    const result = await callCancelDownload('BV1234567890-p1')

    expect(mockInvoke).toHaveBeenCalledWith('cancel_download', {
      downloadId: 'BV1234567890-p1',
    })
    expect(result).toBe(true)
  })

  it('should return false when the download was not found', async () => {
    mockInvoke.mockResolvedValue(false)

    const result = await callCancelDownload('already-completed-id')

    expect(result).toBe(false)
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue(new Error('Cancel failed'))

    await expect(callCancelDownload('BV1-p1')).rejects.toThrow('Cancel failed')
  })
})
