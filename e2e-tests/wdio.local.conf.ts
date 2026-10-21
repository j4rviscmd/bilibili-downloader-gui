// WebdriverIO configuration for LOCAL-REAL E2E tests.
//
// Unlike wdio.conf.ts (CI fixture E2E), this configuration:
// - starts NO fixture server and sets NO E2E_API_BASE — the app talks
//   to the real Bilibili API with the developer's real Firefox cookies
// - runs only the specs under local/ (the CI glob ./test/**/*.e2e.ts
//   never matches them, and .github/workflows/e2e.yml runs wdio.conf.ts)
// - aborts up front when a port the run needs is already occupied:
//   tauri-plugin-webdriver's bridge port 4445 is held by ANY running
//   app instance, and tauri-webdriver then automates that stale
//   instance's empty webview instead of the freshly launched one
//   (observed 2026-10-18: 3-day-old leftover instance made the whole
//   suite query a blank page)
//
// Run with: npm run test:local (from e2e-tests/). Requires a logged-in
// Firefox profile (real cookies) — the specs fail fast when not.

import type { ChildProcess } from 'node:child_process'
import { execSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { E2E_DOWNLOAD_DIR } from './helpers/app.helpers'
import {
  config as baseConfig,
  killTree,
  spawnWithLogging,
  waitForReady,
  waitForTcpReady,
} from './wdio.conf'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

let viteProcess: ChildProcess | undefined
let tauriWebdriverProcess: ChildProcess | undefined

/**
 * Rejects when something already listens on the port. Probes both the
 * IPv4 loopback and `localhost` (macOS vite binds ::1 only — PR #687).
 */
async function assertPortFree(port: number, owner: string): Promise<void> {
  for (const host of ['127.0.0.1', 'localhost']) {
    const { promise, resolve } = Promise.withResolvers<boolean>()
    const socket = net.connect({ port, host })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => {
      socket.destroy()
      resolve(false)
    })
    const inUse = await promise
    if (inUse) {
      throw new Error(
        `Port ${port} (${owner}) is already in use. ` +
          'Quit running bilibili-downloader-gui instances / dev servers ' +
          'before running local E2E — a leftover app instance makes ' +
          'tauri-webdriver automate its dead webview.',
      )
    }
  }
}

/**
 * Synchronous port-listener kill, used as an onComplete backstop and to
 * clean up a failed tauri-webdriver startup attempt in onPrepare.
 *
 * - Windows: killTree's `taskkill /T` is spawned fire-and-forget, and the
 *   wdio launcher exits right after onComplete — the in-flight taskkill
 *   dies with the process teardown and the node.exe running vite survives,
 *   holding port 1420 and failing the NEXT run's preflight (observed
 *   2026-10-20). Only a SYNCHRONOUS kill completes in time.
 * - macOS: Unix killTree signals only the direct child, so BOTH the
 *   npm→vite grandchild AND the tauri-webdriver→app grandchild survive
 *   every run (observed 2026-10-21: a leaked vite kept serving stale
 *   frontend on 1420 and a leaked app held 4445 — the next run's app then
 *   loaded the STALE frontend and its webdriver bridge collided, which is
 *   what the "Unable to connect to localhost:4444" failures were).
 *
 * The preflight guarantees whatever listens at onComplete belongs to this
 * run (it aborts otherwise), so a port-keyed kill is safe.
 */
function killPortListener(port: number): void {
  // Best-effort only: a failure here must not skip the settings restore
  // that runs after this call in onComplete.
  try {
    if (process.platform === 'win32') {
      const rows = execSync('netstat -ano', { encoding: 'utf8' }).split(/\r?\n/)
      // Runtime-collected PIDs: dynamic membership, so a Set (ts-set-map).
      const pids = new Set<string>()
      for (const row of rows) {
        const cols = row.trim().split(/\s+/)
        // "  TCP    [::1]:1420    [::]:0    LISTENING    41400"
        if (
          cols.length === 5 &&
          cols[3] === 'LISTENING' &&
          cols[1].endsWith(`:${port}`)
        ) {
          pids.add(cols[4])
        }
      }
      for (const pid of pids) spawnSync('taskkill', ['/pid', pid, '/T', '/F'])
      return
    }
    // macOS/Unix: lsof exits 1 when nothing listens — that is not an error.
    const out = execSync(`lsof -nP -tiTCP:${port} -sTCP:LISTEN`, {
      encoding: 'utf8',
    })
    for (const pid of out
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean)) {
      try {
        process.kill(Number(pid), 'SIGKILL')
      } catch {
        // Already gone — racing the graceful killTree above.
      }
    }
  } catch {
    // Mop-up failure is non-fatal; the next run's preflight reports it.
  }
}

// The local run mutates the developer's real settings.json (specs patch
// dlOutputPath into a temp dir). The per-spec teardown patch-back cannot
// restore an unset path — patch_settings rejects a null dlOutputPath —
// and a hard-killed run restores nothing, so the temp path lingers and
// later runs record it as the "original". Restore at the file level.
// Note: must track the backend's get_settings_path() — app_data_dir()/
// settings.json (src-tauri/src/utils/paths.rs; dev and release builds
// share the dir via the same bundle identifier). A drift makes existsSync
// false and silently no-ops backup/restore instead of erroring.
const settingsPath = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'com.bilibili-downloader-gui.app',
  'settings.json',
)
const settingsBackupPath = `${settingsPath}.e2e-bak`
const loginStatePath = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'com.bilibili-downloader-gui.app',
  'login_state.json',
)
const loginStateBackupPath = `${loginStatePath}.e2e-bak`

// undefined = backupSettings never ran (onPrepare aborted at preflight);
// false = no original settings.json, so restore must also remove a file
// the run itself created.
let settingsExisted: boolean | undefined

function backupSettings(): void {
  settingsExisted = fs.existsSync(settingsPath)
  if (!settingsExisted) return
  if (fs.existsSync(settingsBackupPath)) {
    // A previous run was killed before restoring; keep the older backup
    // so the next onComplete still restores to the true original.
    console.log(`[e2e-local] keeping stale backup ${settingsBackupPath}`)
  } else {
    fs.copyFileSync(settingsPath, settingsBackupPath)
  }
  // Patch the live copy so the run's startup update check stays OFF: the
  // dev updater (enableDevUpdater=true in the developer's real settings)
  // pops a full-screen UpdateNotification dialog whenever a GitHub
  // release is newer than the local build, and its overlay blocks every
  // click — the whole suite failed the night v1.73.0 shipped while local
  // builds were on v1.72.0 (observed 2026-10-20, reproduced on main).
  // restoreSettings puts the original file back byte-for-byte.
  try {
    const json = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<
      string,
      unknown
    >
    if (json.enableDevUpdater === true) {
      json.enableDevUpdater = false
      fs.writeFileSync(settingsPath, JSON.stringify(json, null, 2))
      console.log('[e2e-local] disabled enableDevUpdater for this run')
    }
  } catch (err) {
    // Unreadable/unparseable settings: leave as-is — the dev updater gate
    // itself fails closed (undefined flag = updater off).
    console.warn('[e2e-local] settings patch skipped:', err)
  }
}

// The suite's "real cookies" precondition requires login_method=firefox:
// initialize() honors the stored method strictly (no cross-method
// fallback), and a store left on qrCode/manual skips the Firefox cookie
// read entirely — every login/subtitle test then fails with "no cookies
// available" (observed 2026-10-21: login_state.json flipped to qrCode at
// 14:45 and broke three consecutive runs). Pin the method for the run;
// restoreLoginState puts the original file back byte-for-byte.
function backupLoginState(): void {
  if (!fs.existsSync(loginStatePath)) return
  if (!fs.existsSync(loginStateBackupPath)) {
    fs.copyFileSync(loginStatePath, loginStateBackupPath)
  }
  try {
    const json = JSON.parse(fs.readFileSync(loginStatePath, 'utf8')) as {
      loginState?: { method?: string }
    }
    if (json.loginState?.method !== 'firefox') {
      json.loginState = { ...(json.loginState ?? {}), method: 'firefox' }
      fs.writeFileSync(loginStatePath, JSON.stringify(json, null, 2))
      console.log('[e2e-local] pinned login method to firefox for this run')
    }
  } catch (err) {
    console.warn('[e2e-local] login_state patch skipped:', err)
  }
}

function restoreLoginState(): void {
  if (fs.existsSync(loginStateBackupPath)) {
    fs.copyFileSync(loginStateBackupPath, loginStatePath)
    fs.rmSync(loginStateBackupPath)
    console.log(`[e2e-local] restored ${loginStatePath}`)
  }
}

function restoreSettings(): void {
  if (fs.existsSync(settingsBackupPath)) {
    fs.copyFileSync(settingsBackupPath, settingsPath)
    fs.rmSync(settingsBackupPath)
    console.log(`[e2e-local] restored ${settingsPath}`)
    return
  }
  // No original file existed and the run created one — the temp
  // dlOutputPath inside would linger as the next run's "original".
  if (settingsExisted === false && fs.existsSync(settingsPath)) {
    fs.rmSync(settingsPath)
    console.log(`[e2e-local] removed ${settingsPath} created during the run`)
  }
}

// Interrupted runs (Ctrl-C/SIGINT — wdio skips onComplete on SIGINT,
// observed 2026-10-20) never reach the per-spec teardown either, so the
// fixed E2E download dir would linger under ~/Downloads until this
// heal-on-next-completed-run removal. Concurrent runs cannot exist
// (port preflight).
function cleanupDownloadDir(): void {
  fs.rmSync(E2E_DOWNLOAD_DIR, { recursive: true, force: true })
}

export const config = {
  ...baseConfig,
  specs: ['./local/**/*.local.e2e.ts'],

  async onPrepare() {
    // Preflight BEFORE spawning anything: vite (1420), tauri-webdriver
    // (4444) and the app-side webdriver plugin bridge (4445).
    await assertPortFree(1420, 'Vite dev server')
    await assertPortFree(4444, 'tauri-webdriver')
    await assertPortFree(4445, 'app webdriver bridge')
    // After preflight so a fast-fail abort (occupied port) leaves no
    // dangling backup.
    backupSettings()
    backupLoginState()

    viteProcess = spawnWithLogging('npm', ['run', 'dev'], 'vite', {
      cwd: projectRoot,
      shell: process.platform === 'win32',
    })
    await waitForReady('http://localhost:1420', 'Vite dev server', 30_000)

    // E2E_TESTING only — deliberately NO E2E_API_BASE so the backend
    // hits the live Bilibili API (see fetch_video_info's fixture gate).
    // E2E_BACKGROUND shows the app window WITHOUT ever taking keyboard or
    // menu-bar focus (Accessory activation policy + no set_focus; see
    // show_main / apply_e2e_background_tweaks in src-tauri/src/window.rs).
    // The window must stay shown: a never-shown window is never drawn and
    // WebKit stalls it in ways private APIs cannot disable (measured
    // 2026-10-21: whole-suite download stall on an idle machine). CI
    // fixture e2e (wdio.conf.ts) never sets E2E_BACKGROUND.
    // The spawned app inherits this env through tauri-webdriver.
    // Why retry: tauri-webdriver occasionally fails its first startup
    // (transient bind/hang — observed 2026-10-21: one run failed with
    // "Unable to connect to localhost:4444" 15s after spawn, while the
    // identical next run started cleanly). A single retry after killing
    // the failed attempt covers it without masking a persistent problem
    // (the second failure still aborts the run).
    for (let attempt = 1; ; attempt++) {
      tauriWebdriverProcess = spawnWithLogging(
        'tauri-webdriver',
        ['--port', '4444'],
        'tauri-webdriver',
        { env: { E2E_TESTING: 'true', E2E_BACKGROUND: 'true' } },
      )
      try {
        await waitForTcpReady('localhost', 4444, 'tauri-webdriver', 15_000)
        break
      } catch (err) {
        killTree(tauriWebdriverProcess)
        killPortListener(4444)
        if (attempt >= 2) throw err
        console.warn(
          `[e2e-local] tauri-webdriver startup attempt ${attempt} failed, retrying:`,
          err,
        )
        const { promise, resolve } = Promise.withResolvers<void>()
        setTimeout(resolve, 2_000)
        await promise
      }
    }
  },

  async onComplete() {
    killTree(tauriWebdriverProcess)
    killTree(viteProcess)
    killPortListener(1420)
    killPortListener(4444)
    killPortListener(4445)
    // Restore after the kills — a live app could still write settings.
    try {
      restoreSettings()
    } catch (err) {
      console.error('[e2e-local] settings restore failed:', err)
    }
    try {
      restoreLoginState()
    } catch (err) {
      console.error('[e2e-local] login_state restore failed:', err)
    }
    try {
      cleanupDownloadDir()
    } catch (err) {
      console.error('[e2e-local] download dir cleanup failed:', err)
    }
  },

  // Real-network downloads + hard-subtitle burn-ins can each run for
  // minutes on a long video; the CI 180s budget does not apply here.
  mochaOpts: {
    ui: 'bdd',
    timeout: 600_000,
  },
}
