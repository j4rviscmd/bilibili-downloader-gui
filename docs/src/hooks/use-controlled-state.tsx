import * as React from "react";

/**
 * Common controlled state props.
 */
interface CommonControlledStateProps<T> {
  /** Controlled value from parent */
  value?: T;
  /** Default value for uncontrolled state */
  defaultValue?: T;
}

/**
 * Custom hook for managing controlled or uncontrolled component state.
 *
 * Handles both controlled (value prop) and uncontrolled (defaultValue)
 * state patterns. When value changes externally, internal state updates.
 * Calls onChange callback when state changes.
 *
 * @param props - Object containing value, defaultValue, and onChange callback
 * @returns Tuple of [current state, state setter function]
 *
 * @example
 * ```tsx
 * const [open, setOpen] = useControlledState({
 *   value: props.open,
 *   defaultValue: false,
 *   onChange: props.onOpenChange,
 * });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useControlledState<T, Rest extends any[] = []>(
  props: CommonControlledStateProps<T> & {
    onChange?: (value: T, ...args: Rest) => void;
  },
): readonly [T, (next: T, ...args: Rest) => void] {
  const { value, defaultValue, onChange } = props;

  const [state, setInternalState] = React.useState<T>(
    value !== undefined ? value : (defaultValue as T),
  );

  React.useEffect(() => {
    if (value !== undefined) setInternalState(value);
  }, [value]);

  const setState = React.useCallback(
    (next: T, ...args: Rest) => {
      setInternalState(next);
      onChange?.(next, ...args);
    },
    [onChange],
  );

  return [state, setState] as const;
}
