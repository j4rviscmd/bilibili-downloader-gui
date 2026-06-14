/** Discriminated union of client-side validation error kinds. */
export type ConcatValidationError =
  | 'no_files'
  | 'single_file'
  | 'duplicate_paths'

/**
 * Validates the file list for concatenation on the client side.
 *
 * Checks that at least two files are provided and that no duplicate
 * paths exist. Returns a {@link ConcatValidationError} on the first
 * failing check, or `null` if all checks pass.
 *
 * @param files - Array of absolute file path strings.
 * @returns A validation error code, or `null` if the input is valid.
 */
export function validateConcatFiles(
  files: string[],
): ConcatValidationError | null {
  if (files.length === 0) return 'no_files'
  if (files.length === 1) return 'single_file'
  if (new Set(files).size !== files.length) return 'duplicate_paths'
  return null
}
