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

console.log('Tauri APIs mocked successfully')
