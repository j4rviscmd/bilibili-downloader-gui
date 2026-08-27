import { mockInvoke } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { expandShortUrl } from './expandShortUrl'

describe('expandShortUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call invoke with expand_short_url command and url', async () => {
    mockInvoke.mockResolvedValue('https://www.bilibili.com/video/BV1xx411c7XD')

    const result = await expandShortUrl('https://b23.tv/BV1xx411c7XD')

    expect(mockInvoke).toHaveBeenCalledWith('expand_short_url', {
      url: 'https://b23.tv/BV1xx411c7XD',
    })
    expect(result).toBe('https://www.bilibili.com/video/BV1xx411c7XD')
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue(new Error('Redirect limit exceeded'))

    await expect(expandShortUrl('https://b23.tv/invalid')).rejects.toThrow(
      'Redirect limit exceeded',
    )
  })
})
