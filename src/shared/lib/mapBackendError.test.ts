import { describe, expect, it } from 'vitest'

import { mapBackendError } from './mapBackendError'

describe('mapBackendError', () => {
  it('maps a known video error code to its translation key', () => {
    expect(mapBackendError('ERR::VIDEO_NOT_FOUND')).toBe(
      'video.video_not_found',
    )
  })

  it('maps ERR::INVALID_MEDIA_RESPONSE to its key', () => {
    expect(mapBackendError('ERR::INVALID_MEDIA_RESPONSE')).toBe(
      'video.invalid_media_response',
    )
  })

  it('maps ERR::NETWORK:: with a dynamic suffix to the fixed network key', () => {
    expect(mapBackendError('ERR::NETWORK::2 segment(s) failed')).toBe(
      'video.network_error',
    )
  })

  it('returns null for ERR::UNAUTHORIZED (handled by tauriBaseQuery)', () => {
    expect(mapBackendError('ERR::UNAUTHORIZED')).toBeNull()
  })

  it('returns null for unknown ERR:: codes so callers fall back to the raw message', () => {
    expect(mapBackendError('ERR::SOME_UNKNOWN_CODE')).toBeNull()
  })

  it('returns null for plain non-ERR messages', () => {
    expect(mapBackendError('Connection reset by peer')).toBeNull()
  })
})
