import {
  debug as tauriDebug,
  error as tauriError,
  info as tauriInfo,
  trace as tauriTrace,
  warn as tauriWarn,
} from '@tauri-apps/plugin-log'

const FE_PREFIX = '[FE]'

/**
 * Formats a log message with the frontend prefix and masks sensitive information.
 *
 * @param message - The raw log message to format
 * @returns The formatted message with prefix and sensitive data masked
 */
function formatMessage(message: string): string {
  return `${FE_PREFIX} ${maskSensitiveInfo(message)}`
}

const SENSITIVE_PATTERNS = [
  'SESSDATA=',
  'bili_jct=',
  'DedeUserID=',
  'access_token=',
  'refresh_token=',
]

/**
 * Masks sensitive authentication and token information in log messages.
 *
 * Replaces the values of known sensitive parameters (e.g., SESSDATA, bili_jct,
 * access_token) with "***" to prevent credentials from being written to log files.
 *
 * @param message - The log message that may contain sensitive information
 * @returns The message with sensitive values masked
 */
function maskSensitiveInfo(message: string): string {
  let result = message
  for (const pattern of SENSITIVE_PATTERNS) {
    const regex = new RegExp(`(${pattern})([^\\s;,",)]*)`, 'g')
    result = result.replace(regex, '$1***')
  }
  return result
}

/**
 * Unified logger interface for the frontend.
 *
 * Provides consistent logging across the application with automatic
 * frontend prefix "[FE]" and sensitive data masking for security.
 * All logs are routed through the Tauri log plugin.
 *
 * @example
 * ```typescript
 * logger.info("User logged in");
 * logger.error("Failed to fetch data", error);
 * logger.debug("State updated", { count: 5 });
 * ```
 */
export const logger = {
  trace: (message: string) => {
    tauriTrace(formatMessage(message))
  },
  debug: (message: string) => {
    tauriDebug(formatMessage(message))
  },
  info: (message: string) => {
    tauriInfo(formatMessage(message))
  },
  warn: (message: string) => {
    tauriWarn(formatMessage(message))
  },
  error: (message: string, error?: unknown) => {
    const formatted = error
      ? formatMessage(`${message}: ${String(error)}`)
      : formatMessage(message)
    tauriError(formatted)
  },
}
