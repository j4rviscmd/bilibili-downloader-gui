// WebdriverIO configuration for bilibili-downloader-gui E2E tests.
// Manages the full E2E lifecycle: Vite dev server + tauri-webdriver
// startup, Mocha BDD spec execution, and process teardown.
// E2E_TESTING=true env var bypasses OS keychain for CI.

import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  startFixtureServer,
  type FixtureServer,
} from './helpers/fixture-server'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

let viteProcess: ChildProcess | undefined
let tauriWebdriverProcess: ChildProcess | undefined
let fixtureServer: FixtureServer | undefined

/**
 * Spawn a child process and pipe stdout/stderr with a label prefix.
 *
 * @param command - The executable to spawn
 * @param args - Arguments passed to the executable
 * @param label - Prefix used when logging process output
 * @param options - Optional cwd and additional env variables
 * @returns The spawned ChildProcess instance
 */
function spawnWithLogging(
  command: string,
  args: string[],
  label: string,
  options?: { cwd?: string; env?: Record<string, string> },
): ChildProcess {
  const proc = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: options?.cwd,
    env: { ...process.env, ...options?.env },
  })
  const logLines = (data: Buffer, logFn: (msg: string) => void) => {
    for (const line of data.toString().split('\n')) {
      if (line.trim()) logFn(`[${label}] ${line}`)
    }
  }
  proc.stdout?.on('data', (d: Buffer) => logLines(d, console.log))
  proc.stderr?.on('data', (d: Buffer) => logLines(d, console.error))
  return proc
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Poll an HTTP URL until it returns a successful response.
 *
 * @param url - The HTTP URL to poll
 * @param label - Human-readable label for log/error messages
 * @param timeout - Maximum wait time in ms (default 30 000)
 * @param interval - Time between polls in ms (default 500)
 * @throws When the URL does not respond within the timeout
 */
async function waitForReady(
  url: string,
  label: string,
  timeout = 30_000,
  interval = 500,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url)
      if (res.ok) {
        console.log(`[OK] ${label} is ready`)
        return
      }
    } catch {
      // not ready yet
    }
    await wait(interval)
  }
  throw new Error(`${label} did not become ready within ${timeout}ms`)
}

/**
 * Poll a TCP port until it accepts connections.
 *
 * @param host - Hostname or IP address
 * @param port - TCP port number
 * @param label - Human-readable label for log/error messages
 * @param timeout - Maximum wait time in ms (default 15 000)
 * @param interval - Time between attempts in ms (default 500)
 * @throws When the port does not accept connections within the timeout
 */
async function waitForTcpReady(
  host: string,
  port: number,
  label: string,
  timeout = 15_000,
  interval = 500,
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = new net.Socket()
      socket.on('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.on('error', () => {
        socket.destroy()
        resolve(false)
      })
      socket.connect(port, host)
    })
    if (connected) {
      console.log(`[OK] ${label} is ready`)
      return
    }
    await wait(interval)
  }
  throw new Error(`${label} did not become ready within ${timeout}ms`)
}

export const config = {
  runner: 'local',
  specs: ['./test/**/*.e2e.ts'],
  maxInstances: 1,
  capabilities: [
    {
      'tauri:options': {
        application: path.resolve(
          __dirname,
          '../src-tauri/target/debug/bilibili-downloader-gui',
        ),
      },
    },
  ],

  hostname: 'localhost',
  port: 4444,
  path: '/',

  // wdio hooks
  async onPrepare() {
    // 1. Start Vite dev server
    viteProcess = spawnWithLogging('npm', ['run', 'dev'], 'vite', {
      cwd: projectRoot,
    })
    await waitForReady('http://localhost:1420', 'Vite dev server', 30_000)

    // 2. Start the fixture API/media server. Must be up before the app
    // spawns: the app's BiliApi redirects to it via E2E_API_BASE (see
    // BiliApi::from_cookie_header). Request log rides the screenshots
    // artifact upload for failure triage.
    const screenshotsDir = path.resolve(__dirname, 'screenshots')
    fs.mkdirSync(screenshotsDir, { recursive: true })
    const fixtureLog = path.join(screenshotsDir, 'fixture-server.log')
    fs.writeFileSync(fixtureLog, '')
    fixtureServer = await startFixtureServer(fixtureLog)

    // 3. Start tauri-webdriver (E2E_TESTING bypasses OS keychain; the app
    // inherits this env, so E2E_API_BASE reaches the backend too)
    tauriWebdriverProcess = spawnWithLogging(
      'tauri-webdriver',
      ['--port', '4444'],
      'tauri-webdriver',
      {
        env: {
          E2E_TESTING: 'true',
          E2E_API_BASE: `http://127.0.0.1:${fixtureServer.port}`,
        },
      },
    )
    await waitForTcpReady('localhost', 4444, 'tauri-webdriver', 15_000)
  },

  async onComplete() {
    tauriWebdriverProcess?.kill('SIGTERM')
    viteProcess?.kill('SIGTERM')
    await fixtureServer?.close()
  },

  // Test framework
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 90_000,
  },

  // Reporter
  reporters: ['spec'],

  // Base options
  baseUrl: 'http://localhost:1420',
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 3,
}
