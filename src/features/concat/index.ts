/**
 * Video concatenation feature — public API barrel.
 *
 * Re-exports the hook, types, and main UI component for external consumers.
 */
export {
  useConcat,
  type ConcatStatus,
  type UseConcatResult,
} from './hooks/useConcat'
export type { ConcatOptions, ConcatProgress, ConcatResult } from './types'
export { default as ConcatForm } from './ui/ConcatForm'
