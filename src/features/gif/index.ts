/**
 * GIF/WebM generator feature module.
 *
 * Cuts a time range out of a local MP4 and re-encodes it as an animated
 * GIF (256-color) or a silent VP9 WebM via ffmpeg.
 *
 * @module gif
 */

// Public API: Components
export { default as GifForm } from './ui/GifForm'

// Public API: Hooks
export { useGif, type GifStatus, type UseGifResult } from './hooks/useGif'

// Public API: Types
export type {
  GifFormat,
  GifFpsPreset,
  GifOptions,
  GifProgress,
  GifResult,
  GifWidthPreset,
} from './types'
