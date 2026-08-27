import { describe, expect, it } from 'vitest'

import { validateConcatFiles } from './validation'

describe('validateConcatFiles', () => {
  it('rejects an empty file list', () => {
    expect(validateConcatFiles([])).toBe('no_files')
  })

  it('rejects a single file', () => {
    expect(validateConcatFiles(['/a.mp4'])).toBe('single_file')
  })

  it('rejects duplicate paths', () => {
    expect(validateConcatFiles(['/a.mp4', '/b.mp4', '/a.mp4'])).toBe(
      'duplicate_paths',
    )
  })

  it('accepts two or more unique paths', () => {
    expect(validateConcatFiles(['/a.mp4', '/b.mp4'])).toBeNull()
    expect(validateConcatFiles(['/a.mp4', '/b.mp4', '/c.mp4'])).toBeNull()
  })
})
