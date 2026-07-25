/** Aggregated application and environment information.
 *
 * Mirrors the Rust `AppInfo` struct returned by the `get_app_info`
 * command. Kept flat and stable so the future bug-report flow can reuse
 * it to prefill GitHub issue bodies. */
export interface AppInfo {
  /** Product name (tauri.conf.json productName). */
  app_name: string
  /** App version (tauri.conf.json version). */
  app_version: string
  /** Tauri framework version. */
  tauri_version: string
  /** Normalized OS name: "windows" | "macos" | "linux" | ... */
  os_name: string
  /** OS version string (e.g. "10.0.26200"). */
  os_version: string
  /** CPU architecture (e.g. "x86_64", "aarch64"). */
  arch: string
}
