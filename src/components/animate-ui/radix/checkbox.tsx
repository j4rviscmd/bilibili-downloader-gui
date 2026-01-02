'use client';

import * as React from 'react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { motion, type SVGMotionProps, type HTMLMotionProps } from 'motion/react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';
import { getStrictContext } from '@/components/animate-ui/lib/get-strict-context';
import { useControlledState } from '@/components/animate-ui/hooks/use-controlled-state';

// Context
type CheckboxContextType = {
  isChecked: boolean | 'indeterminate';
  setIsChecked: (checked: boolean | 'indeterminate') => void;
};

const [CheckboxProvider, useCheckbox] =
  getStrictContext<CheckboxContextType>('CheckboxContext');

// Primitive
type CheckboxRootProps = HTMLMotionProps<'button'> &
  Omit<React.ComponentProps<typeof CheckboxPrimitive.Root>, 'asChild'>;

function CheckboxRoot({
  defaultChecked,
  checked,
  onCheckedChange,
  disabled,
  required,
  name,
  value,
  ...props
}: CheckboxRootProps) {
  const [isChecked, setIsChecked] = useControlledState({
    value: checked,
    defaultValue: defaultChecked,
    onChange: onCheckedChange,
  });

  return (
    <CheckboxProvider value={{ isChecked, setIsChecked }}>
      <CheckboxPrimitive.Root
        defaultChecked={defaultChecked}
        checked={checked}
        onCheckedChange={setIsChecked}
        disabled={disabled}
        required={required}
        name={name}
        value={value}
        asChild
      >
        <motion.button
          data-slot="checkbox"
          whileTap={{ scale: 0.95 }}
          whileHover={{ scale: 1.05 }}
          {...props}
        />
      </CheckboxPrimitive.Root>
    </CheckboxProvider>
  );
}

type CheckboxIndicatorProps = SVGMotionProps<SVGSVGElement>;

function CheckboxIndicator(props: CheckboxIndicatorProps) {
  const { isChecked } = useCheckbox();

  return (
    <CheckboxPrimitive.Indicator forceMount asChild>
      <motion.svg
        data-slot="checkbox-indicator"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth="3.5"
        stroke="currentColor"
        initial="unchecked"
        animate={isChecked ? 'checked' : 'unchecked'}
        {...props}
      >
        {isChecked === 'indeterminate' ? (
          <motion.line
            x1="5"
            y1="12"
            x2="19"
            y2="12"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{
              pathLength: 1,
              opacity: 1,
              transition: { duration: 0.2 },
            }}
          />
        ) : (
          <motion.path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.5 12.75l6 6 9-13.5"
            variants={{
              checked: {
                pathLength: 1,
                opacity: 1,
                transition: {
                  duration: 0.2,
                  delay: 0.2,
                },
              },
              unchecked: {
                pathLength: 0,
                opacity: 0,
                transition: {
                  duration: 0.2,
                },
              },
            }}
          />
        )}
      </motion.svg>
    </CheckboxPrimitive.Indicator>
  );
}

// Styled Component
const checkboxVariants = cva(
  'peer shrink-0 flex items-center justify-center outline-none ' +
    'focus-visible:ring-[3px] focus-visible:ring-ring/50 ' +
    'aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 ' +
    'disabled:cursor-not-allowed disabled:opacity-50 ' +
    'transition-colors duration-500 focus-visible:ring-offset-2 ' +
    '[&[data-state=checked],&[data-state=indeterminate]]:bg-primary ' +
    '[&[data-state=checked],&[data-state=indeterminate]]:text-primary-foreground',
  {
    variants: {
      variant: {
        default: 'bg-background border',
        accent: 'bg-input',
      },
      size: {
        default: 'size-5 rounded-sm',
        sm: 'size-4 rounded-[5px]',
        lg: 'size-6 rounded-[7px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

const checkboxIndicatorVariants = cva('', {
  variants: {
    size: {
      default: 'size-3.5',
      sm: 'size-3',
      lg: 'size-4',
    },
  },
  defaultVariants: {
    size: 'default',
  },
});

type CheckboxProps = CheckboxRootProps & VariantProps<typeof checkboxVariants>;

function Checkbox({
  className,
  children,
  variant,
  size,
  ...props
}: CheckboxProps) {
  return (
    <CheckboxRoot
      className={cn(checkboxVariants({ variant, size, className }))}
      {...props}
    >
      {children}
      <CheckboxIndicator className={cn(checkboxIndicatorVariants({ size }))} />
    </CheckboxRoot>
  );
}

export {
  Checkbox,
  CheckboxRoot,
  CheckboxIndicator,
  useCheckbox,
  type CheckboxProps,
  type CheckboxRootProps,
  type CheckboxIndicatorProps,
  type CheckboxContextType,
};
