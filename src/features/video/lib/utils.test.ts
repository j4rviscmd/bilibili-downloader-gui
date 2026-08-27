import { describe, expect, it } from 'vitest'

import {
  buildVideoUrl,
  extractContentId,
  extractVideoId,
  normalizeFilename,
} from './utils'

describe('extractContentId', () => {
  it('extracts a bvid from a video URL', () => {
    expect(
      extractContentId('https://www.bilibili.com/video/BV1xx411c7XD'),
    ).toEqual({ type: 'video', id: 'BV1xx411c7XD' })
  })

  it('ignores query parameters when extracting the video id', () => {
    expect(
      extractContentId('https://www.bilibili.com/video/BV1xx411c7XD?p=2&t=10'),
    ).toEqual({ type: 'video', id: 'BV1xx411c7XD' })
  })

  it('extracts a numeric epId from a bangumi URL', () => {
    expect(
      extractContentId('https://www.bilibili.com/bangumi/play/ep3051843'),
    ).toEqual({ type: 'bangumi', epId: '3051843' })
  })

  it('prefers the bangumi match over the video match', () => {
    expect(
      extractContentId('https://www.bilibili.com/bangumi/play/ep1/video/x'),
    ).toEqual({ type: 'bangumi', epId: '1' })
  })

  it('matches regardless of hostname (pathname-only matching)', () => {
    expect(extractContentId('https://example.com/video/BV1xx411c7XD')).toEqual({
      type: 'video',
      id: 'BV1xx411c7XD',
    })
  })

  it('returns null for a URL without video/bangumi segments', () => {
    expect(extractContentId('https://www.bilibili.com/space/12345')).toBeNull()
  })

  it('returns null for an invalid URL string', () => {
    expect(extractContentId('not-a-url')).toBeNull()
    expect(extractContentId('')).toBeNull()
  })
})

describe('extractVideoId', () => {
  it('extracts the id after /video/', () => {
    expect(extractVideoId('https://www.bilibili.com/video/BV1xx411c7XD')).toBe(
      'BV1xx411c7XD',
    )
  })

  it('returns null when there is no /video/ segment', () => {
    expect(
      extractVideoId('https://www.bilibili.com/bangumi/play/ep1'),
    ).toBeNull()
  })

  it('is a plain regex over the string (no URL parsing)', () => {
    expect(extractVideoId('/video/BV1abc')).toBe('BV1abc')
  })
})

describe('normalizeFilename', () => {
  it('lowercases and trims', () => {
    expect(normalizeFilename('  My Video ')).toBe('my video')
  })

  it('strips every forbidden character', () => {
    expect(normalizeFilename('My:Video<Part>1?')).toBe('myvideopart1')
  })

  it('strips backslashes and forward slashes', () => {
    expect(normalizeFilename('a\\b/c')).toBe('abc')
  })
})

describe('buildVideoUrl', () => {
  it('omits the page query for page 1', () => {
    expect(buildVideoUrl('BV1xx411c7XD', 1)).toBe(
      'https://www.bilibili.com/video/BV1xx411c7XD',
    )
  })

  it('appends ?p=N for pages after the first', () => {
    expect(buildVideoUrl('BV1xx411c7XD', 3)).toBe(
      'https://www.bilibili.com/video/BV1xx411c7XD?p=3',
    )
  })
})
