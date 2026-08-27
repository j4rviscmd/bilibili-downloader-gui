/**
 * In-memory event bus backing the `@tauri-apps/api/event` mock.
 *
 * `vi.mock` factories are hoisted above top-level imports, so the bus
 * module must be imported lazily inside the factory (see setup.ts).
 *
 * Tests dispatch backend events via `emitTauriEvent` and assert listener
 * detachment by emitting after unmount and observing no state change.
 */

export type TauriEventHandler = (event: {
  event: string
  payload: unknown
  id: number
  windowLabel: string
}) => void

const registry = new Map<string, Set<TauriEventHandler>>()
let nextId = 0

/** Dispatches a Tauri event to all registered listeners. */
export function emitTauriEvent(name: string, payload: unknown): void {
  const handlers = registry.get(name)
  if (!handlers) return
  for (const handler of handlers) {
    handler({ event: name, payload, id: nextId++, windowLabel: 'main' })
  }
}

/** Removes every registered listener (call in `afterEach` for isolation). */
export function clearTauriEvents(): void {
  registry.clear()
}

/** Registers a listener; returns its unlisten function like the real API. */
export function addTauriEventListener(
  name: string,
  handler: TauriEventHandler,
): () => void {
  let handlers = registry.get(name)
  if (!handlers) {
    handlers = new Set()
    registry.set(name, handlers)
  }
  handlers.add(handler)
  return () => {
    registry.get(name)?.delete(handler)
  }
}
