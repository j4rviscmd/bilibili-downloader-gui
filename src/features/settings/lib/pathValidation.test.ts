import { describe, expect, it } from 'vitest'

import { validateOutputPath } from './pathValidation'

const t = ((key: string) => key) as never

describe('validateOutputPath', () => {
  describe('valid paths', () => {
    it.each([
      ['/downloads'],
      ['/home/user/Videos'],
      ['C:\\Users\\me\\Videos'],
      ['D:'],
      ['relative/path'],
    ])('accepts %s', (path) => {
      expect(validateOutputPath(path, t)).toBeNull()
    })
  })

  it('rejects an empty path as required', () => {
    expect(validateOutputPath('', t)).toBe('validation.path.required')
  })

  it('rejects paths longer than 1024 characters as too_long', () => {
    expect(validateOutputPath(`/${'a'.repeat(1024)}`, t)).toBe(
      'validation.path.too_long',
    )
  })

  it('accepts a path of exactly 1024 characters', () => {
    expect(validateOutputPath(`/${'a'.repeat(1023)}`, t)).toBeNull()
  })

  it('rejects control characters', () => {
    expect(validateOutputPath('/a\x01b', t)).toBe(
      'validation.path.control_chars',
    )
  })

  describe('Windows-specific rules', () => {
    it('rejects a colon outside the drive-letter position', () => {
      expect(validateOutputPath('C:\\Users\\be:st', t)).toBe(
        'validation.path.windows.colon',
      )
    })

    it('rejects invalid Windows characters', () => {
      expect(validateOutputPath('C:\\Users\\me<Videos', t)).toBe(
        'validation.path.windows.invalid_chars',
      )
    })

    it('rejects a segment ending with a space', () => {
      expect(validateOutputPath('C:\\folder \\videos', t)).toBe(
        'validation.path.windows.segment_trailing',
      )
    })

    // validateOutputPath returns the FIRST issue; a path-final space/dot
    // also makes the final segment invalid, so the segment rule wins.
    it('rejects a path ending with a space', () => {
      expect(validateOutputPath('C:\\Users\\me ', t)).toBe(
        'validation.path.windows.segment_trailing',
      )
    })

    it('rejects a path ending with a dot', () => {
      expect(validateOutputPath('C:\\Users\\me.', t)).toBe(
        'validation.path.windows.segment_trailing',
      )
    })

    it.each(['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT9'])(
      'rejects the reserved device name %s as a segment',
      (reserved) => {
        expect(validateOutputPath(`C:\\data\\${reserved}`, t)).toBe(
          'validation.path.windows.reserved',
        )
      },
    )

    it('matches reserved names case-insensitively', () => {
      expect(validateOutputPath('C:\\data\\con', t)).toBe(
        'validation.path.windows.reserved',
      )
    })

    it('does not treat a longer name containing a reserved word as reserved', () => {
      expect(validateOutputPath('C:\\data\\console', t)).toBeNull()
    })
  })

  it('rejects invalid characters in a non-Windows, non-POSIX path', () => {
    expect(validateOutputPath('my<file', t)).toBe(
      'validation.path.invalid_chars',
    )
  })
})
