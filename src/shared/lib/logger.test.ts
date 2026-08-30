/**
 * logger suite. Asserts the [FE] prefix, sensitive-value masking, and the
 * error-with-object formatting against the Tauri log plugin mocks.
 */

import {
  error as tauriError,
  info as tauriInfo,
  trace as tauriTrace,
  warn as tauriWarn,
} from '@tauri-apps/plugin-log'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logger } from './logger'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('logger', () => {
  it('prefixes plain messages with [FE]', () => {
    logger.info('hello')

    expect(tauriInfo).toHaveBeenCalledWith('[FE] hello')
  })

  it('masks SESSDATA and bili_jct values', () => {
    logger.warn('cookie SESSDATA=abc123, bili_jct=xyz')

    // Masked values keep the parameter name but drop the secret.
    expect(tauriWarn).toHaveBeenCalledWith(
      '[FE] cookie SESSDATA=***, bili_jct=***',
    )
  })

  it('masks token values terminated by quotes or parentheses', () => {
    logger.info('refresh(access_token=tok1) json "refresh_token=tok2"')

    expect(tauriInfo).toHaveBeenCalledWith(
      '[FE] refresh(access_token=***) json "refresh_token=***"',
    )
  })

  it('formats error with the thrown value appended', () => {
    logger.error('Download failed', new Error('ERR::NETWORK::timeout'))

    expect(tauriError).toHaveBeenCalledWith(
      '[FE] Download failed: Error: ERR::NETWORK::timeout',
    )
  })

  it('logs error without an error argument', () => {
    logger.error('Plain failure')

    expect(tauriError).toHaveBeenCalledWith('[FE] Plain failure')
  })

  it('routes trace through the trace plugin fn', () => {
    logger.trace('tr')

    expect(tauriTrace).toHaveBeenCalledWith('[FE] tr')
  })
})
