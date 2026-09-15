// Cross-platform development launcher for `npm start`.
//
// Windows / macOS / Linux: runs `npm run tauri dev` directly.
// WSL: relaunches it through Windows cmd.exe so vite, cargo and the app all
// run as native Windows processes — required to verify Windows-only
// behavior (WebView2, #[cfg(windows)] code paths, CREATE_NO_WINDOW, ...).

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { platform } from 'node:process'

const CMD_EXE_FALLBACK = '/mnt/c/Windows/System32/cmd.exe'

function isWsl() {
  if (platform !== 'linux') return false
  try {
    return readFileSync('/proc/version', 'utf8')
      .toLowerCase()
      .includes('microsoft')
  } catch {
    return false
  }
}

// Capture stdout of a command quietly (no console noise on failure paths).
function capture(cmd, args) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

function findCmdExe() {
  // With appendWindowsPath=false in /etc/wsl.conf, cmd.exe is not on the
  // WSL PATH; fall back to the standard mount location.
  try {
    return capture('sh', ['-c', 'command -v cmd.exe'])
  } catch {
    return existsSync(CMD_EXE_FALLBACK) ? CMD_EXE_FALLBACK : null
  }
}

// Resolve the Windows-side Node.js installation directory (Windows path
// form). Returns '' when `where node` already resolves — nothing to add.
function windowsNodeDir(cmdExe) {
  try {
    execFileSync(cmdExe, ['/c', 'where node'], { stdio: 'ignore' })
    return ''
  } catch {
    // Not on the Windows PATH — fall through to fnm's default alias.
  }
  // Why: fnm-managed Windows Node.js is not on the non-interactive cmd.exe
  // PATH, so `where node` misses it; resolve fnm's default alias instead
  // (see CONTRIBUTING.md "Developing on WSL").
  try {
    const appdata = capture(cmdExe, ['/c', 'echo %APPDATA%'])
    const fnmDefault = realpathSync(
      `${capture('wslpath', [appdata])}/fnm/aliases/default`,
    )
    return capture('wslpath', ['-w', fnmDefault])
  } catch {
    console.error(
      [
        'error: Node.js not found on the Windows side.',
        'Install Node.js on Windows (official installer, fnm, nvm-windows, ...)',
        'and make sure `where node` resolves in cmd.exe, then retry.',
      ].join('\n'),
    )
    process.exit(1)
  }
}

// Forward termination signals so vite/cargo clean up, then mirror the exit
// code of the child process.
function launch(child) {
  child.on('error', (err) => {
    console.error('error:', err.message)
    process.exit(1)
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal))
  }
  child.on('exit', (code) => process.exit(code ?? 1))
}

if (isWsl()) {
  const cmdExe = findCmdExe()
  if (!cmdExe) {
    console.error(
      'error: cmd.exe not found. Is this really WSL with interop enabled?',
    )
    process.exit(1)
  }
  const nodeDir = windowsNodeDir(cmdExe)
  const winDir = capture('wslpath', ['-w', process.cwd()])
  if (winDir.startsWith('\\\\')) {
    console.error(
      'error: the project must live on a Windows drive (e.g. /mnt/c) — ' +
        'cmd.exe cannot use a WSL-filesystem working directory.',
    )
    process.exit(1)
  }
  // Why cwd option instead of `cd /d "path"`: the WSL interop layer escapes
  // embedded double quotes in argv, so a quoted cd command always breaks;
  // passing the drvfs cwd here lets interop translate it to the Windows path.
  // `&&` is glued to %PATH% so the trailing space is not baked into PATH.
  const pathPrefix = nodeDir ? `set PATH=${nodeDir};%PATH%&& ` : ''
  launch(
    spawn(cmdExe, ['/c', `${pathPrefix}npm run tauri dev`], {
      stdio: 'inherit',
      cwd: process.cwd(),
    }),
  )
} else {
  // Plain Windows / macOS / Linux: identical to `npm run tauri dev`.
  const npm = platform === 'win32' ? 'npm.cmd' : 'npm'
  launch(
    spawn(npm, ['run', 'tauri', 'dev'], {
      stdio: 'inherit',
      shell: platform === 'win32',
    }),
  )
}
