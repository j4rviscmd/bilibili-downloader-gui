import type { Settings } from '@/features/settings/type'
import { mockInvoke } from '@/test/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  callGetCurrentLibPath,
  callGetSettings,
  callSetSettings,
  callUpdateLibPath,
} from './settingApi'

const mockSettings: Settings = {
  dlOutputPath: '/downloads',
  language: 'en',
}

describe('callGetSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call invoke with get_settings command', async () => {
    mockInvoke.mockResolvedValue(mockSettings)

    const result = await callGetSettings()

    expect(mockInvoke).toHaveBeenCalledWith('get_settings')
    expect(result).toEqual(mockSettings)
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue(new Error('Settings file corrupted'))

    await expect(callGetSettings()).rejects.toThrow('Settings file corrupted')
  })
})

describe('callSetSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call invoke with set_settings command and settings', async () => {
    mockInvoke.mockResolvedValue(undefined)

    await callSetSettings(mockSettings)

    expect(mockInvoke).toHaveBeenCalledWith('set_settings', {
      settings: mockSettings,
    })
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue(new Error('Disk full'))

    await expect(callSetSettings(mockSettings)).rejects.toThrow('Disk full')
  })
})

describe('callUpdateLibPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call invoke with update_lib_path command and newPath', async () => {
    mockInvoke.mockResolvedValue(undefined)

    await callUpdateLibPath('/Volumes/ExternalDrive/MyLib')

    expect(mockInvoke).toHaveBeenCalledWith('update_lib_path', {
      newPath: '/Volumes/ExternalDrive/MyLib',
    })
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue(new Error('Move failed'))

    await expect(callUpdateLibPath('/bad/path')).rejects.toThrow('Move failed')
  })
})

describe('callGetCurrentLibPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should call invoke with get_current_lib_path command', async () => {
    mockInvoke.mockResolvedValue('/app/data/lib')

    const result = await callGetCurrentLibPath()

    expect(mockInvoke).toHaveBeenCalledWith('get_current_lib_path')
    expect(result).toBe('/app/data/lib')
  })

  it('should propagate errors from backend', async () => {
    mockInvoke.mockRejectedValue(new Error('No lib path'))

    await expect(callGetCurrentLibPath()).rejects.toThrow('No lib path')
  })
})
