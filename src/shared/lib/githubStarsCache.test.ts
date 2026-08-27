import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearCachedStars,
  getCachedStars,
  isCacheValid,
  setCachedStars,
} from './githubStarsCache'

const KEY = 'github_stars_owner_repo'

describe('githubStarsCache', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('setCachedStars / getCachedStars', () => {
    it('round-trips a star count', () => {
      setCachedStars('owner', 'repo', 1234)

      expect(getCachedStars('owner', 'repo')).toBe(1234)
    })

    it('returns null when nothing is cached', () => {
      expect(getCachedStars('owner', 'repo')).toBeNull()
    })

    it('overwrites a previous entry', () => {
      setCachedStars('owner', 'repo', 1)
      setCachedStars('owner', 'repo', 2)

      expect(getCachedStars('owner', 'repo')).toBe(2)
    })

    it('keys the cache per owner/repo pair', () => {
      setCachedStars('owner', 'repo', 1)
      setCachedStars('owner', 'other', 2)

      expect(getCachedStars('owner', 'repo')).toBe(1)
      expect(getCachedStars('owner', 'other')).toBe(2)
    })
  })

  describe('cache expiry', () => {
    it('returns the count within the 1-hour TTL', () => {
      localStorage.setItem(
        KEY,
        JSON.stringify({ count: 7, timestamp: Date.now() - 60 * 60 * 1000 }),
      )

      expect(getCachedStars('owner', 'repo')).toBe(7)
    })

    it('returns null and removes the entry after the TTL', () => {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          count: 7,
          timestamp: Date.now() - 60 * 60 * 1000 - 1,
        }),
      )

      expect(getCachedStars('owner', 'repo')).toBeNull()
      expect(localStorage.getItem(KEY)).toBeNull()
    })

    it('returns null and removes the entry on corrupt JSON', () => {
      localStorage.setItem(KEY, '{not json')

      expect(getCachedStars('owner', 'repo')).toBeNull()
      expect(localStorage.getItem(KEY)).toBeNull()
    })
  })

  describe('isCacheValid', () => {
    it('is true for a fresh entry and false when absent', () => {
      expect(isCacheValid('owner', 'repo')).toBe(false)

      setCachedStars('owner', 'repo', 5)

      expect(isCacheValid('owner', 'repo')).toBe(true)
    })
  })

  describe('clearCachedStars', () => {
    it('removes the entry', () => {
      setCachedStars('owner', 'repo', 5)
      clearCachedStars('owner', 'repo')

      expect(getCachedStars('owner', 'repo')).toBeNull()
    })

    it('is a no-op when nothing is cached', () => {
      expect(() => clearCachedStars('owner', 'repo')).not.toThrow()
    })
  })
})
