import { describe, expect, it } from 'vitest'

import { buildSettingsFormSchema } from './formSchema'

const t = ((key: string) => key) as never
const schema = buildSettingsFormSchema(t)

const parsePath = (dlOutputPath: string) =>
  schema.safeParse({ dlOutputPath, language: 'en' })

const issueKeys = (result: ReturnType<typeof parsePath>) =>
  result.success ? [] : result.error.issues.map((i) => i.message)

describe('buildSettingsFormSchema — dlOutputPath', () => {
  describe('valid paths', () => {
    it.each([
      ['/downloads'],
      ['/home/user/Videos'],
      ['C:\\Users\\me\\Videos'],
      ['D:'],
      ['relative/path'],
    ])('accepts %s', (path) => {
      expect(parsePath(path).success).toBe(true)
    })
  })

  it('rejects an empty path as required', () => {
    const result = parsePath('')
    expect(result.success).toBe(false)
    expect(issueKeys(result)).toContain('validation.path.required')
  })

  it('rejects paths longer than 1024 characters as too_long', () => {
    const result = parsePath(`/${'a'.repeat(1024)}`)
    expect(result.success).toBe(false)
    expect(issueKeys(result)).toContain('validation.path.too_long')
  })

  it('accepts a path of exactly 1024 characters', () => {
    expect(parsePath(`/${'a'.repeat(1023)}`).success).toBe(true)
  })

  it('rejects control characters', () => {
    const result = parsePath('/a\x01b')
    expect(result.success).toBe(false)
    expect(issueKeys(result)).toContain('validation.path.control_chars')
  })

  describe('Windows-specific rules', () => {
    it('rejects a colon outside the drive-letter position', () => {
      const result = parsePath('C:\\Users\\be:st')
      expect(result.success).toBe(false)
      expect(issueKeys(result)).toContain('validation.path.windows.colon')
    })

    it('rejects invalid Windows characters', () => {
      const result = parsePath('C:\\Users\\me<Videos')
      expect(result.success).toBe(false)
      expect(issueKeys(result)).toContain(
        'validation.path.windows.invalid_chars',
      )
    })

    it('rejects a segment ending with a space', () => {
      const result = parsePath('C:\\folder \\videos')
      expect(result.success).toBe(false)
      expect(issueKeys(result)).toContain(
        'validation.path.windows.segment_trailing',
      )
    })

    it('rejects a path ending with a space', () => {
      const result = parsePath('C:\\Users\\me ')
      expect(result.success).toBe(false)
      expect(issueKeys(result)).toContain(
        'validation.path.windows.path_trailing',
      )
    })

    it('rejects a path ending with a dot', () => {
      const result = parsePath('C:\\Users\\me.')
      expect(result.success).toBe(false)
      expect(issueKeys(result)).toContain(
        'validation.path.windows.path_trailing',
      )
    })

    it.each(['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT9'])(
      'rejects the reserved device name %s as a segment',
      (reserved) => {
        const result = parsePath(`C:\\data\\${reserved}`)
        expect(result.success).toBe(false)
        expect(issueKeys(result)).toContain('validation.path.windows.reserved')
      },
    )

    it('matches reserved names case-insensitively', () => {
      const result = parsePath('C:\\data\\con')
      expect(result.success).toBe(false)
      expect(issueKeys(result)).toContain('validation.path.windows.reserved')
    })

    it('does not treat a longer name containing a reserved word as reserved', () => {
      expect(parsePath('C:\\data\\console').success).toBe(true)
    })
  })

  it('rejects invalid characters in a non-Windows, non-POSIX path', () => {
    const result = parsePath('my<file')
    expect(result.success).toBe(false)
    expect(issueKeys(result)).toContain('validation.path.invalid_chars')
  })
})

describe('buildSettingsFormSchema — language', () => {
  it('accepts all supported languages', () => {
    for (const language of ['en', 'ja', 'fr', 'es', 'zh', 'ko']) {
      expect(
        schema.safeParse({ dlOutputPath: '/downloads', language }).success,
      ).toBe(true)
    }
  })

  it('rejects an unsupported language', () => {
    const result = schema.safeParse({
      dlOutputPath: '/downloads',
      language: 'xx',
    })
    expect(result.success).toBe(false)
    expect(issueKeys(result)).toContain('validation.language.required')
  })
})

describe('buildSettingsFormSchema — libPath', () => {
  it('is optional', () => {
    expect(
      schema.safeParse({ dlOutputPath: '/downloads', language: 'en' }).success,
    ).toBe(true)
  })

  it('validates libPath with the same path rules when provided', () => {
    const result = schema.safeParse({
      dlOutputPath: '/downloads',
      language: 'en',
      libPath: '/lib\x01bad',
    })
    expect(result.success).toBe(false)
    expect(issueKeys(result)).toContain('validation.path.control_chars')
  })
})
