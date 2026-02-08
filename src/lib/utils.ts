import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merges Tailwind CSS class names with conditional logic.
 *
 * Combines clsx for conditional classes and tailwind-merge to resolve
 * conflicting Tailwind classes (e.g., 'p-2' and 'p-4' → 'p-4').
 *
 * @param inputs - Class names, objects, or arrays to merge
 * @returns A merged class name string
 *
 * @example
 * ```typescript
 * cn('px-2 py-1', isActive && 'bg-blue-500', { 'text-white': isActive })
 * // Returns: 'px-2 py-1 bg-blue-500 text-white'
 * ```
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
