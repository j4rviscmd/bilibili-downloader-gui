import { invoke } from '@tauri-apps/api/core'

/**
 * Fetches all release notes from GitHub for versions newer than current.
 *
 * Invokes the 'get_release_notes' Tauri command to retrieve all release notes
 * from the GitHub repository using the GitHub API. The notes are returned
 * as a merged Markdown-formatted string.
 *
 * @param owner - Repository owner (e.g., "j4rviscmd")
 * @param repo - Repository name (e.g., "bilibili-downloader-gui")
 * @param currentVersion - Current application version (e.g., "1.1.0")
 * @returns A promise resolving to the merged release notes in Markdown format
 * @throws Error if the GitHub API request fails or version parsing fails
 *
 * @example
 * ```typescript
 * const notes = await fetchReleaseNotes('j4rviscmd', 'bilibili-downloader-gui', '1.1.0')
 * console.log(notes) // Markdown formatted release notes for all newer versions
 * ```
 */
export const fetchReleaseNotes = async (
  owner: string,
  repo: string,
  currentVersion: string,
): Promise<string> =>
  invoke<string>('get_release_notes', {
    owner,
    repo,
    currentVersion,
  })
