/**
 * Public API for the initialization feature.
 *
 * Handles application startup sequence including ffmpeg validation,
 * cookie checking, user authentication, and version updates.
 * @module features/init
 */

export { initSlice, setInitiated, setProcessingFnc } from './model/initSlice'
export { useInit } from './hooks/useInit'
export type { InitState } from './types'
