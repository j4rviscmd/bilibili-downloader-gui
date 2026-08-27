/**
 * videoSlice minimal roundtrip suite.
 *
 * The slice is two whole-state replacement reducers (setVideo/resetVideo),
 * so the only meaningful coverage is a set/replace/reset roundtrip against
 * the real singleton store.
 */

import { store } from '@/app/store'
import { describe, expect, it } from 'vitest'

import type { Video } from '@/features/video/types'
import { resetVideo, setVideo } from './videoSlice'

const video: Video = {
  title: 'Test Video',
  bvid: 'BV1xx411c7XD',
  parts: [
    {
      part: 'Part 1',
      page: 1,
      cid: 123,
      duration: 120,
      videoQualities: [{ quality: '1080p', id: 80 }],
      audioQualities: [{ quality: '64K', id: 30216 }],
      thumbnail: { url: 'https://example.com/thumb.jpg' },
      subtitles: [],
    },
  ],
  isLimitedQuality: true,
  contentType: 'bangumi',
  epId: 3051843,
  seasonTitle: 'Season 1',
}

function videoState() {
  return store.getState().video
}

describe('videoSlice', () => {
  it('setVideo replaces the whole state including optional bangumi fields', () => {
    store.dispatch(setVideo(video))

    expect(videoState()).toEqual(video)
  })

  it('resetVideo restores the initial empty state', () => {
    store.dispatch(setVideo(video))
    store.dispatch(resetVideo())

    expect(videoState()).toEqual({
      title: '',
      bvid: '',
      parts: [],
      isLimitedQuality: false,
      contentType: 'video',
    })
  })
})
