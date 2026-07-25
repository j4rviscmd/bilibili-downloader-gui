import { invoke } from '@tauri-apps/api/core'
import type { AppInfo } from '../types'

/** Fetches aggregated application and environment info from the backend
 * (`get_app_info` command). */
export const getAppInfo = (): Promise<AppInfo> =>
  invoke<AppInfo>('get_app_info')
