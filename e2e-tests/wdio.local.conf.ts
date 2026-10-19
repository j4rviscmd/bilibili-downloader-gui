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
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

export const config = {
  ...baseConfig,
  specs: ['./local/**/*.local.e2e.ts'],

  async onPrepare() {
    // Preflight BEFORE spawning anything: vite (1420), tauri-webdriver
    // (4444) and the app-side webdriver plugin bridge (4445).
    await assertPortFree(1420, 'Vite dev server')
    await assertPortFree(4444, 'tauri-webdriver')
    await assertPortFree(4445, 'app webdriver bridge')

    viteProcess = spawnWithLogging('npm', ['run', 'dev'], 'vite', {
      cwd: projectRoot,
      shell: process.platform === 'win32',
    })
    await waitForReady('http://localhost:1420', 'Vite dev server', 30_000)

    // E2E_TESTING only — deliberately NO E2E_API_BASE so the backend
    // hits the live Bilibili API (see fetch_video_info's fixture gate).
    // The spawned app inherits this env through tauri-webdriver.
    tauriWebdriverProcess = spawnWithLogging(
      'tauri-webdriver',
      ['--port', '4444'],
      'tauri-webdriver',
      { env: { E2E_TESTING: 'true' } },
    )
    await waitForTcpReady('localhost', 4444, 'tauri-webdriver', 15_000)
  },

  async onComplete() {
    killTree(tauriWebdriverProcess)
    killTree(viteProcess)
  },

  // Real-network downloads + hard-subtitle burn-ins can each run for
  // minutes on a long video; the CI 180s budget does not apply here.
  mochaOpts: {
    ui: 'bdd',
    timeout: 600_000,
  },
}
