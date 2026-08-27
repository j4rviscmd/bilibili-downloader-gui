import '@testing-library/jest-dom'

// Mock Tauri APIs
import { afterEach, vi } from 'vitest'

// Reset the in-memory Tauri event bus between tests: the registry is
// module-global, and a test that discards its unlisten() would otherwise
// leak listeners into later tests in the same file.
import { clearTauriEvents } from './tauriEvents'

afterEach(() => {
  clearTauriEvents()
})

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// Mock @tauri-apps/plugin-log
vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
}))

// Mock @tauri-apps/api/event with an in-memory event bus. The factory is
// hoisted above imports, so the bus module is loaded lazily to keep the
// registry shared with `emitTauriEvent` used by tests.
vi.mock('@tauri-apps/api/event', async () => {
  const { addTauriEventListener } = await import('./tauriEvents')
  return {
    listen: vi.fn(
      async (name: string, handler: (e: { payload: unknown }) => void) =>
        addTauriEventListener(name, handler as never),
    ),
    emit: vi.fn(async () => {}),
  }
})

// Mock @tauri-apps/plugin-dialog. Defaults model "user cancelled"
// (null/false) so tests opt in to a concrete choice explicitly.
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(null),
  confirm: vi.fn().mockResolvedValue(false),
  message: vi.fn().mockResolvedValue(undefined),
  ask: vi.fn().mockResolvedValue(false),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
  openPath: vi.fn().mockResolvedValue(undefined),
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  exit: vi.fn().mockResolvedValue(undefined),
  relaunch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn().mockResolvedValue(null),
}))

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn().mockResolvedValue(undefined),
}))

// Mock @tauri-apps/api/window. useTaskbarProgress and
// useDownloadCompletionNotifications call getCurrentWindow().setProgressBar /
// requestUserAttention. A single hoisted instance is returned so tests can
// grab the same vi.fn references and assert on them.
const { mockCurrentWindow } = vi.hoisted(() => ({
  mockCurrentWindow: {
    setProgressBar: vi.fn().mockResolvedValue(undefined),
    requestUserAttention: vi.fn().mockResolvedValue(undefined),
    setTheme: vi.fn().mockResolvedValue(undefined),
    isFocused: vi.fn().mockResolvedValue(true),
    onFocusChanged: vi.fn().mockResolvedValue(() => {}),
  },
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => mockCurrentWindow,
  ProgressBarStatus: {
    None: 'none',
    Normal: 'normal',
    Pending: 'pending',
    Error: 'error',
    Indeterminate: 'indeterminate',
  },
  UserAttentionType: {
    Critical: 'critical',
    Informational: 'informational',
  },
}))

// Centralized i18n mock. Identity `t` (returns the key) is the established
// assertion style (tests assert raw keys like 'concat.concat'); `{{var}}`
// interpolation is supported for the few components that use it. Both
// `react-i18next` and the raw `i18next` singleton are stubbed because
// ListenerContext calls `i18n.t` on the `@/i18n` import directly.
const { i18nT } = vi.hoisted(() => ({
  i18nT: (key: string, opts?: Record<string, unknown>) =>
    Object.entries(opts ?? {}).reduce(
      (s, [k, v]) => s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v)),
      key,
    ),
}))

vi.mock('i18next', async (requireActual) => {
  // Keep the real module shape (default export etc.) for type compat.
  const actual = await requireActual<typeof import('i18next')>()
  const instance = {
    t: i18nT,
    language: 'en',
    isInitialized: true,
    changeLanguage: vi.fn(),
    use: () => ({ init: () => instance }),
  }
  return { ...actual, ...instance, default: instance }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: i18nT,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
  I18nextProvider: ({ children }: { children: React.ReactNode }) => children,
}))

// happy-dom has no WAAPI; motion components call element.animate at mount.
// ponytail: no-op polyfill; replace only if a test needs animation state.
if (!Element.prototype.animate) {
  Object.defineProperty(Element.prototype, 'animate', {
    value: () => ({
      finished: Promise.resolve(),
      cancel: () => {},
      commitStyles: () => {},
    }),
    configurable: true,
  })
}
