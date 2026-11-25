import { renderWithProviders } from '@/test/test-utils'
import { describe, expect, it } from 'vitest'

import { BilibiliTvMark } from './BilibiliTvMark'

/** Fills of the rendered mark's 8 paths, in document order. */
function pathFills(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('svg path')).map((path) =>
    path.getAttribute('fill'),
  )
}

describe('BilibiliTvMark', () => {
  it.each([
    ['bilibili', '#EC5D85', '#EF85A7', '#EB5480'],
    ['bilibili-blue', '#5DC6EC', '#85D3EF', '#54C3EB'],
  ] as const)(
    'renders the %s colorway with the verbatim asset fills',
    (preset, base, light, dark) => {
      const { container } = renderWithProviders(
        <BilibiliTvMark preset={preset} />,
      )

      // Byte-identity with the deleted bilibili-tv-mark(-blue).svg assets:
      // the 8 paths in document order with the original colorways.
      expect(pathFills(container)).toEqual([
        base,
        light,
        base,
        light,
        '#FFFFFF',
        dark,
        '#FFFFFF',
        dark,
      ])
    },
  )

  it.each(['claude', 'graphite', 'vercel'] as const)(
    'rides the --brand token for the %s preset',
    (preset) => {
      const { container } = renderWithProviders(
        <BilibiliTvMark preset={preset} />,
      )

      expect(pathFills(container)[0]).toBe('var(--brand)')
    },
  )

  it('is decorative and keeps the hero shadow in the brand family', () => {
    const { container } = renderWithProviders(
      <BilibiliTvMark preset="bilibili" withHeroShadow />,
    )
    const verbatimShadow = container.querySelector('svg')?.style.filter

    const { container: tweakcn } = renderWithProviders(
      <BilibiliTvMark preset="claude" withHeroShadow />,
    )

    expect(verbatimShadow).toBe(
      'drop-shadow(0 6px 20px -6px rgb(236 93 133/0.4))',
    )
    expect(tweakcn.querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    )
    expect(tweakcn.querySelector('svg')?.style.filter).toContain(
      'color-mix(in oklab, var(--brand) 40%, transparent)',
    )
  })
})
