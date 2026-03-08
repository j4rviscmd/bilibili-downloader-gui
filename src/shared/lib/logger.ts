import {
  debug as tauriDebug,
  error as tauriError,
  info as tauriInfo,
  trace as tauriTrace,
  warn as tauriWarn,
} from '@tauri-apps/plugin-log'

const FE_PREFIX = '[FE]'

/**
 * Formats a log message with the frontend prefix.
 *
 * @param message - The message to format
 * @returns The formatted message with prefix
 */
function formatMessage(message: string): string {
  return `${FE_PREFIX} ${message}`
}

/**
 * Masks sensitive information (cookies, tokens) from log messages.
 *
 * @param message - The message to sanitize
 * @returns The message with sensitive info masked
 */
function maskSensitiveInfo(message: string): string {
  let result = message

  // Cookie値のマスク
  const cookiePatterns = ['SESSDATA=', 'bili_jct=', 'DedeUserID=']
  for (const pattern of cookiePatterns) {
    const regex = new RegExp(`(${pattern})([^\\s;,")]*)`, 'g')
    result = result.replace(regex, '$1***')
  }

  // Token値のマスク
  const tokenPatterns = ['access_token=', 'refresh_token=']
  for (const pattern of tokenPatterns) {
    const regex = new RegExp(`(${pattern})([^\\s;,")]*)`, 'g')
    result = result.replace(regex, '$1***')
  }

  return result
}

/**
 * Logger utility for frontend logging.
 *
 * Provides logging functions that prefix messages with [FE] to distinguish
 * from backend logs, and automatically masks sensitive information like
 * cookies and tokens.
 */
export const logger = {
  /**
   * Logs a trace message (most verbose level).
   *
   * @param message - The message to log
   */
  trace: (message: string) => tauriTrace(formatMessage(message)),

  /**
   * Logs a debug message.
   *
   * @param message - The message to log
   */
  debug: (message: string) => tauriDebug(formatMessage(message)),

  /**
   * Logs an info message with sensitive info masked.
   *
   * @param message - The message to log
   */
  info: (message: string) =>
    tauriInfo(formatMessage(maskSensitiveInfo(message))),

  /**
   * Logs a warning message.
   *
   * @param message - The message to log
   */
  warn: (message: string) => tauriWarn(formatMessage(message)),

  /**
   * Logs an error message with optional error details.
   *
   * @param message - The error message
   * @param error - Optional error object or value to include
   */
  error: (message: string, error?: unknown) => {
    const formatted = error
      ? formatMessage(`${maskSensitiveInfo(message)}: ${String(error)}`)
      : formatMessage(maskSensitiveInfo(message))
    tauriError(formatted)
  },
}
