import '@testing-library/jest-dom'

// Mock Tauri APIs
import { vi } from 'vitest'

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

console.log('Tauri APIs mocked successfully')
