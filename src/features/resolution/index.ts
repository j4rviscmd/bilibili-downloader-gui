/**
 * Resolution feature module.
 *
 * Provides downscaling of video resolution using ffmpeg scale filter.
 * Supports preset height values (1080, 720, 480, 360) and custom height input.
 *
 * @module resolution
 */

// Public API: Components
export { default as ResolutionForm } from './ui/ResolutionForm'

// Public API: Hooks
export {
  useResolution,
  type ResolutionStatus,
  type UseResolutionResult,
} from './hooks/useResolution'

// Public API: Preset helpers
export {
  DEFAULT_TARGET_HEIGHT,
  RESOLUTION_HEIGHT_PRESETS,
  getEnabledResolutions,
  selectBestEffortResolution,
  type ResolutionHeightPreset,
} from './lib/resolution'

// Public API: Types
export type {
  ResolutionOptions,
  ResolutionProgress,
  ResolutionResult,
} from './types'
