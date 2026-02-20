import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combines and merges Tailwind CSS class names.
 *
 * Uses clsx for conditional class name composition and tailwind-merge
 * to resolve conflicts between Tailwind classes. Later classes override
 * earlier ones when they affect the same CSS properties.
 *
 * @param inputs - Class values to combine (strings, objects, arrays)
 * @returns Merged class name string
 *
 * @example
 * ```tsx
 * cn('px-2', 'px-4') // Returns 'px-4'
 * cn('text-sm', condition && 'font-bold') // Conditionally applies classes
 * ```
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
