import * as React from "react";

/**
 * Factory function for creating a strictly typed React context with Provider and hook.
 *
 * Creates a context with a Provider component and a custom hook that throws
 * an error if used outside the Provider. This prevents undefined context errors
 * and improves developer experience with clear error messages.
 *
 * @param name - Optional name for better error messages
 * @returns Tuple of [Provider component, useContext hook]
 *
 * @example
 * ```tsx
 * const [ThemeProivder, useTheme] = getStrictContext<ThemeType>('Theme');
 *
 * // In parent:
 * <ThemeProvider value={theme}>{children}</ThemeProvider>
 *
 * // In child:
 * const theme = useTheme(); // Throws if used outside Provider
 * ```
 */
function getStrictContext<T>(
  name?: string,
): readonly [
  ({
    value,
    children,
  }: {
    value: T;
    children?: React.ReactNode;
  }) => React.JSX.Element,
  () => T,
] {
  const Context = React.createContext<T | undefined>(undefined);

  const Provider = ({
    value,
    children,
  }: {
    value: T;
    children?: React.ReactNode;
  }) => <Context.Provider value={value}>{children}</Context.Provider>;

  const useSafeContext = () => {
    const ctx = React.useContext(Context);
    if (ctx === undefined) {
      throw new Error(`useContext must be used within ${name ?? "a Provider"}`);
    }
    return ctx;
  };

  return [Provider, useSafeContext] as const;
}

export { getStrictContext };
