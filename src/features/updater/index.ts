/**
 * Public API for the updater feature.
 *
 * Manages application updates including version checking,
 * release notes fetching, download progress, and update installation.
 * @module features/updater
 */

export * from '@/features/updater/model/updaterSlice'
export * from '@/features/updater/types'
export * from '@/features/updater/api/updaterApi'
export { UpdateNotification } from '@/features/updater/ui/UpdateNotification'
