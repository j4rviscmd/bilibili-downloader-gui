import inputReducer, {
  defaultSubtitleConfig,
  initPartInputs,
  resetInput,
  setPartQualities,
  setPartSubtitles,
  setQualitiesLoading,
  setSubtitlesLoading,
  updateSubtitleConfig,
} from '@/features/video/model/inputSlice'
import type { SubtitleConfig, SubtitleInfo } from '@/features/video/types'
import { describe, expect, it } from 'vitest'

describe('inputSlice', () => {
  const initialState = {
    url: '',
    partInputs: [],
    pendingDownload: null,
  }

  describe('defaultSubtitleConfig', () => {
    it('should have default values', () => {
      expect(defaultSubtitleConfig).toEqual({
        mode: 'off',
        selectedLans: [],
      })
    })
  })

  describe('initPartInputs', () => {
    it('should initialize part inputs with default subtitle config', () => {
      const parts = [
        {
          cid: 123,
          page: 1,
          title: 'Part 1',
          videoQuality: '80',
          audioQuality: '30216',
          selected: true,
          duration: 120,
        },
      ]

      const state = inputReducer(initialState, initPartInputs(parts))

      expect(state.partInputs).toHaveLength(1)
      expect(state.partInputs[0].subtitle).toEqual(defaultSubtitleConfig)
    })

    it('should preserve explicit subtitle config', () => {
      const customConfig: SubtitleConfig = {
        mode: 'soft',
        selectedLans: ['zh-CN'],
      }
      const parts = [
        {
          cid: 123,
          page: 1,
          title: 'Part 1',
          videoQuality: '80',
          audioQuality: '30216',
          selected: true,
          duration: 120,
          subtitle: customConfig,
        },
      ]

      const state = inputReducer(initialState, initPartInputs(parts))

      expect(state.partInputs[0].subtitle).toEqual(customConfig)
    })
  })

  describe('updateSubtitleConfig', () => {
    it('should update subtitle config for a specific part', () => {
      const stateWithParts = {
        ...initialState,
        partInputs: [
          {
            cid: 123,
            page: 1,
            title: 'Part 1',
            videoQuality: '80',
            audioQuality: '30216',
            selected: true,
            duration: 120,
            subtitle: defaultSubtitleConfig,
          },
        ],
      }

      const newConfig: SubtitleConfig = {
        mode: 'soft',
        selectedLans: ['zh-CN', 'en'],
      }

      const state = inputReducer(
        stateWithParts,
        updateSubtitleConfig({ index: 0, config: newConfig }),
      )

      expect(state.partInputs[0].subtitle).toEqual(newConfig)
    })

    it('should not modify state if index is out of bounds', () => {
      const stateWithParts = {
        ...initialState,
        partInputs: [
          {
            cid: 123,
            page: 1,
            title: 'Part 1',
            videoQuality: '80',
            audioQuality: '30216',
            selected: true,
            duration: 120,
            subtitle: defaultSubtitleConfig,
          },
        ],
      }

      const newConfig: SubtitleConfig = {
        mode: 'hard',
        selectedLans: ['ja'],
      }

      const state = inputReducer(
        stateWithParts,
        updateSubtitleConfig({ index: 99, config: newConfig }),
      )

      expect(state.partInputs[0].subtitle).toEqual(defaultSubtitleConfig)
    })
  })

  describe('setSubtitlesLoading', () => {
    it('should set subtitles loading state', () => {
      const stateWithParts = {
        ...initialState,
        partInputs: [
          {
            cid: 123,
            page: 1,
            title: 'Part 1',
            videoQuality: '80',
            audioQuality: '30216',
            selected: true,
            duration: 120,
            subtitle: defaultSubtitleConfig,
          },
        ],
      }

      const state = inputReducer(
        stateWithParts,
        setSubtitlesLoading({ index: 0, loading: true }),
      )

      expect(state.partInputs[0].subtitlesLoading).toBe(true)
    })

    it('should clear loading state', () => {
      const stateWithLoading = {
        ...initialState,
        partInputs: [
          {
            cid: 123,
            page: 1,
            title: 'Part 1',
            videoQuality: '80',
            audioQuality: '30216',
            selected: true,
            duration: 120,
            subtitle: defaultSubtitleConfig,
            subtitlesLoading: true,
          },
        ],
      }

      const state = inputReducer(
        stateWithLoading,
        setSubtitlesLoading({ index: 0, loading: false }),
      )

      expect(state.partInputs[0].subtitlesLoading).toBe(false)
    })
  })

  describe('setPartSubtitles', () => {
    it('should set subtitles and clear loading state', () => {
      const stateWithLoading = {
        ...initialState,
        partInputs: [
          {
            cid: 123,
            page: 1,
            title: 'Part 1',
            videoQuality: '80',
            audioQuality: '30216',
            selected: true,
            duration: 120,
            subtitle: defaultSubtitleConfig,
            subtitlesLoading: true,
          },
        ],
      }

      const subtitles: SubtitleInfo[] = [
        {
          lan: 'zh-CN',
          lanDoc: '中文（简体）',
          subtitleUrl: 'https://example.com/zh.json',
          isAi: false,
        },
        {
          lan: 'en',
          lanDoc: 'English',
          subtitleUrl: 'https://example.com/en.json',
          isAi: true,
        },
      ]

      const state = inputReducer(
        stateWithLoading,
        setPartSubtitles({ index: 0, subtitles }),
      )

      expect(state.partInputs[0].subtitles).toEqual(subtitles)
      expect(state.partInputs[0].subtitlesLoading).toBe(false)
    })

    it('should set empty subtitles array', () => {
      const stateWithParts = {
        ...initialState,
        partInputs: [
          {
            cid: 123,
            page: 1,
            title: 'Part 1',
            videoQuality: '80',
            audioQuality: '30216',
            selected: true,
            duration: 120,
            subtitle: defaultSubtitleConfig,
            subtitlesLoading: true,
          },
        ],
      }

      const state = inputReducer(
        stateWithParts,
        setPartSubtitles({ index: 0, subtitles: [] }),
      )

      expect(state.partInputs[0].subtitles).toEqual([])
      expect(state.partInputs[0].subtitlesLoading).toBe(false)
    })
  })

  describe('setQualitiesLoading', () => {
    it('should set qualities loading state', () => {
      const stateWithParts = {
        ...initialState,
        partInputs: [
          {
            cid: 123,
            page: 1,
            title: 'Part 1',
            videoQuality: '80',
            audioQuality: '30216',
            selected: true,
            duration: 120,
            subtitle: defaultSubtitleConfig,
          },
        ],
      }

      const state = inputReducer(
        stateWithParts,
        setQualitiesLoading({ index: 0, loading: true }),
      )

      expect(state.partInputs[0].qualitiesLoading).toBe(true)
    })
  })

  describe('setPartQualities', () => {
    it('should set qualities and clear loading state', () => {
      const stateWithLoading = {
        ...initialState,
        partInputs: [
          {
            cid: 123,
            page: 1,
            title: 'Part 1',
            videoQuality: '',
            audioQuality: '',
            selected: true,
            duration: 120,
            subtitle: defaultSubtitleConfig,
            qualitiesLoading: true,
          },
        ],
      }

      const videoQualities = [{ quality: '1080p', id: 80 }]
      const audioQualities = [{ quality: '64K', id: 30216 }]

      const state = inputReducer(
        stateWithLoading,
        setPartQualities({ index: 0, videoQualities, audioQualities }),
      )

      expect(state.partInputs[0].videoQualities).toEqual(videoQualities)
      expect(state.partInputs[0].audioQualities).toEqual(audioQualities)
      expect(state.partInputs[0].qualitiesLoading).toBe(false)
      expect(state.partInputs[0].videoQuality).toBe('80')
      expect(state.partInputs[0].audioQuality).toBe('30216')
    })

    it('should not override existing quality selection', () => {
      const stateWithQuality = {
        ...initialState,
        partInputs: [
          {
            cid: 123,
            page: 1,
            title: 'Part 1',
            videoQuality: '116',
            audioQuality: '30280',
            selected: true,
            duration: 120,
            subtitle: defaultSubtitleConfig,
            qualitiesLoading: true,
          },
        ],
      }

      const videoQualities = [{ quality: '1080p', id: 80 }]
      const audioQualities = [{ quality: '64K', id: 30216 }]

      const state = inputReducer(
        stateWithQuality,
        setPartQualities({ index: 0, videoQualities, audioQualities }),
      )

      expect(state.partInputs[0].videoQuality).toBe('116')
      expect(state.partInputs[0].audioQuality).toBe('30280')
    })
  })

  describe('resetInput', () => {
    it('should reset to initial state', () => {
      const stateWithData = {
        url: 'https://bilibili.com/video/BV123',
        partInputs: [
          {
            cid: 123,
            page: 1,
            title: 'Part 1',
            videoQuality: '80',
            audioQuality: '30216',
            selected: true,
            duration: 120,
            subtitle: {
              mode: 'soft',
              selectedLans: ['zh-CN'],
            } as SubtitleConfig,
            subtitles: [
              {
                lan: 'zh-CN',
                lanDoc: '中文',
                subtitleUrl: 'https://example.com/zh.json',
                isAi: false,
              },
            ],
            subtitlesLoading: false,
          },
        ],
        pendingDownload: { bvid: 'BV123', cid: 123, page: 1 },
      }

      const state = inputReducer(stateWithData, resetInput())

      expect(state).toEqual(initialState)
    })
  })
})
