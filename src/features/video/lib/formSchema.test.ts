import { beforeEach, describe, expect, it, vi } from 'vitest'

// The invalid-filename pattern is initialized once per module instance from
// the detected OS, so schema-2 tests re-import the module per OS scenario.
// The hoisted vi.fn survives vi.resetModules(), unlike module-level state.
const { mockGetOs } = vi.hoisted(() => ({ mockGetOs: vi.fn() }))
vi.mock('@/shared/os/api/getOs', () => ({ getOs: mockGetOs }))

import { buildVideoFormSchema1 } from './formSchema'

const t = ((key: string) => key) as never

async function importFormSchema() {
  vi.resetModules()
  const mod = await import('./formSchema')
  // Let the module-load initInvalidPattern() promise settle
  await new Promise((resolve) => setTimeout(resolve, 0))
  return mod
}

const parseUrl = (url: string) => buildVideoFormSchema1(t).safeParse({ url })

const issueKeys = (result: ReturnType<typeof parseUrl>) =>
  result.success ? [] : result.error.issues.map((i) => i.message)

describe('buildVideoFormSchema1 — url', () => {
  it.each([
    ['https://www.bilibili.com/video/BV1xx411c7XD'],
    ['https://www.bilibili.com/video/BV1xx411c7Xd?p=2'],
    ['https://www.bilibili.com/bangumi/play/ep3051843'],
    ['https://b23.tv/BV1xx411c7XD'],
  ])('accepts %s', (url) => {
    expect(parseUrl(url).success).toBe(true)
  })

  it('rejects a url shorter than 2 characters', () => {
    const result = parseUrl('a')
    expect(result.success).toBe(false)
    expect(issueKeys(result)).toContain('validation.video.url.min')
  })

  it('rejects a url longer than 1000 characters', () => {
    const result = parseUrl(
      `https://www.bilibili.com/video/${'a'.repeat(1000)}`,
    )
    expect(result.success).toBe(false)
    expect(issueKeys(result)).toContain('validation.video.url.max')
  })

  it('rejects a non-URL string', () => {
    const result = parseUrl('not-a-url')
    expect(result.success).toBe(false)
    expect(issueKeys(result)).toContain('validation.video.url.invalid')
  })

  it('rejects a non-bilibili domain', () => {
    const result = parseUrl('https://example.com/video/BV1xx411c7XD')
    expect(result.success).toBe(false)
    expect(issueKeys(result)).toContain('validation.video.url.domain')
  })

  it('rejects a bilibili path that is neither video nor bangumi', () => {
    const result = parseUrl('https://www.bilibili.com/space/12345')
    expect(result.success).toBe(false)
    expect(issueKeys(result)).toContain('validation.video.url.format')
  })

  it.each([
    ['https://space.bilibili.com/12345', 'validation.video.url.space'],
    ['https://member.bilibili.com/2', 'validation.video.url.member'],
    ['https://live.bilibili.com/6', 'validation.video.url.live'],
    ['https://au.bilibili.com/123', 'validation.video.url.audio'],
  ])('rejects unsupported hostname %s with a specific key', (url, key) => {
    const result = parseUrl(url)
    expect(result.success).toBe(false)
    expect(issueKeys(result)).toContain(key)
  })

  it.each([
    [
      'https://www.bilibili.com/bangumi/media/md123',
      'validation.video.url.bangumi_list',
    ],
    ['https://www.bilibili.com/cheese/play/ep1', 'validation.video.url.cheese'],
    ['https://www.bilibili.com/audio/au123', 'validation.video.url.audio'],
    ['https://www.bilibili.com/read/cv123', 'validation.video.url.article'],
  ])('rejects unsupported pathname %s with a specific key', (url, key) => {
    const result = parseUrl(url)
    expect(result.success).toBe(false)
    expect(issueKeys(result)).toContain(key)
  })
})

describe('buildVideoFormSchema2 — title (windows)', () => {
  beforeEach(() => {
    mockGetOs.mockReset().mockResolvedValue('windows')
  })

  async function parseTitle(title: string) {
    const { buildVideoFormSchema2 } = await importFormSchema()
    return buildVideoFormSchema2(t).safeParse({
      title,
      videoQuality: '',
      audioQuality: '',
    })
  }

  it('accepts a plain title', async () => {
    expect((await parseTitle('My Video')).success).toBe(true)
  })

  it('rejects a title shorter than 2 characters', async () => {
    const result = await parseTitle('a')
    expect(result.success).toBe(false)
    expect(
      result.success ? [] : result.error.issues.map((i) => i.message),
    ).toContain('validation.video.title.min')
  })

  it('rejects a title longer than 100 characters', async () => {
    const result = await parseTitle('a'.repeat(101))
    expect(result.success).toBe(false)
    expect(
      result.success ? [] : result.error.issues.map((i) => i.message),
    ).toContain('validation.video.title.max')
  })

  it.each(['My:Video', 'My<Video', 'My*Video', 'My?Video', 'My|Video'])(
    'rejects the Windows-forbidden character in %s',
    async (title) => {
      const result = await parseTitle(title)
      expect(result.success).toBe(false)
      expect(
        result.success ? [] : result.error.issues.map((i) => i.message),
      ).toContain('validation.video.title.invalid_chars')
    },
  )

  it.each(['My Video.', 'My Video '])(
    'rejects the Windows trailing dot/space in %s',
    async (title) => {
      const result = await parseTitle(title)
      expect(result.success).toBe(false)
    },
  )
})

describe('buildVideoFormSchema2 — title (non-windows)', () => {
  beforeEach(() => {
    mockGetOs.mockReset().mockResolvedValue('macos')
  })

  async function parseTitle(title: string) {
    const { buildVideoFormSchema2 } = await importFormSchema()
    return buildVideoFormSchema2(t).safeParse({
      title,
      videoQuality: '',
      audioQuality: '',
    })
  }

  it('accepts characters that are only invalid on Windows', async () => {
    expect((await parseTitle('My:Video')).success).toBe(true)
    expect((await parseTitle('My Video.')).success).toBe(true)
  })

  it('still rejects a forward slash', async () => {
    const result = await parseTitle('My/Video')
    expect(result.success).toBe(false)
    expect(
      result.success ? [] : result.error.issues.map((i) => i.message),
    ).toContain('validation.video.title.invalid_chars')
  })
})
