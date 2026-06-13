/**
 * Trim feature module.
 *
 * Provides trimming of local MP4 files via ffmpeg in two modes: fast
 * stream copy (`-c copy`) or accurate re-encode (`libx264`/`aac`).
 *
 * @module trim
 */

// Public API: Components
export { default as TrimForm } from './ui/TrimForm'

// Public API: Hooks
export { useTrim, type TrimStatus, type UseTrimResult } from './hooks/useTrim'

// Public API: Types
export type { TrimMode, TrimOptions, TrimProgress, TrimResult } from './types'
