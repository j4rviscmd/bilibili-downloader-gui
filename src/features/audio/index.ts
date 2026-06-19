/**
 * Audio feature module.
 *
 * Provides extraction of the audio track from local MP4 files into MP3
 * (`.mp3`) or AAC (`.m4a`) via ffmpeg, with bitrate presets gated by the
 * source audio bitrate.
 *
 * @module audio
 */

// Public API: Components
export { default as AudioForm } from './ui/AudioForm'

// Public API: Hooks
export {
  useAudio,
  type AudioStatus,
  type UseAudioResult,
} from './hooks/useAudio'

// Public API: Types
export type {
  AudioFormat,
  AudioOptions,
  AudioProgress,
  AudioResult,
} from './types'
