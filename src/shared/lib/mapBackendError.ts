import { isUnauthorizedError } from '@/app/lib/invokeErrorHandler'

/**
 * Maps backend error codes (ERR::*) to i18n translation keys.
 *
 * Backend returns error strings containing codes like "ERR::VIDEO_NOT_FOUND".
 * This maps them to translation keys for localized user-facing messages.
 * Dynamic parts (e.g., "N segment(s) failed" in ERR::NETWORK::) are discarded;
 * the fixed message is used instead.
 *
 * Extracted from VideoInfoContext.getErrorMessage so queue display paths
 * (PartStatusRow / PartDownloadProgress) can share the same mapping.
 */
const VIDEO_ERROR_MAP: Record<string, string> = {
  'ERR::VIDEO_NOT_FOUND': 'video.video_not_found',
  'ERR::COOKIE_MISSING': 'video.cookie_missing',
  'ERR::API_ERROR': 'video.api_error',
  'ERR::FILE_EXISTS': 'video.file_exists',
  'ERR::DISK_FULL': 'video.disk_full',
  'ERR::MERGE_FAILED': 'video.merge_failed',
  'ERR::QUALITY_NOT_FOUND': 'video.quality_not_found',
  'ERR::RATE_LIMITED': 'video.rate_limited',
  // Bangumi error codes
  'ERR::BANGUMI_NOT_FOUND': 'video.bangumi_not_found',
  'ERR::BANGUMI_VIP_ONLY': 'video.bangumi_vip_only',
  'ERR::BANGUMI_REGION_RESTRICTED': 'video.bangumi_region_restricted',
  'ERR::BANGUMI_COPYRIGHT_RESTRICTED': 'video.bangumi_copyright_restricted',
  'ERR::BANGUMI_ACCESS_DENIED': 'video.bangumi_access_denied',
  'ERR::BANGUMI_NO_DASH': 'video.bangumi_no_dash',
  'ERR::BANGUMI_DURL_NOT_SUPPORTED': 'video.bangumi_durl_not_supported',
  // Audio / media download error codes
  'ERR::INVALID_MEDIA_RESPONSE': 'video.invalid_media_response',
  'ERR::AUDIO_DOWNLOAD_FAILED': 'video.audio_download_failed',
  // Why: trailing "::" matches the "ERR::NETWORK::<detail>" shape produced
  // by retry_download (it appends segment-failure details after the code),
  // so the dynamic suffix is discarded and the fixed key is returned.
  'ERR::NETWORK::': 'video.network_error',
}

/**
 * Maps a backend error message to a localized translation key.
 *
 * The caller is responsible for invoking the i18n `t()` function with the
 * returned key. Returns `null` when the message should fall back to the
 * original raw string (unknown code) or is already handled elsewhere
 * (UNAUTHORIZED).
 *
 * @param errorMessage - Raw error string from backend (may contain ERR::* code)
 * @returns Translation key string if a known ERR::* code is found, otherwise null
 *
 * @example
 * ```ts
 * mapBackendError('ERR::VIDEO_NOT_FOUND') // => 'video.video_not_found'
 * mapBackendError('ERR::NETWORK::2 segment(s) failed') // => 'video.network_error'
 * mapBackendError('ERR::UNAUTHORIZED') // => null (handled by tauriBaseQuery)
 * mapBackendError('Some raw message') // => null (use original)
 * ```
 */
export function mapBackendError(errorMessage: string): string | null {
  // ERR::UNAUTHORIZED is handled by tauriBaseQuery/interceptInvokeError.
  if (isUnauthorizedError(errorMessage)) return null

  for (const [code, key] of Object.entries(VIDEO_ERROR_MAP)) {
    if (errorMessage.includes(code)) return key
  }

  return null
}
