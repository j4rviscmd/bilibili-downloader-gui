'use client'

import { Circle } from 'lucide-react'
import {
  AnimatePresence,
  motion,
  type HTMLMotionProps,
  type Transition,
} from 'motion/react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/shared/lib/utils'

type RadioGroupProps = React.ComponentProps<typeof RadioGroupPrimitive.Root> & {
  transition?: Transition
}

function RadioGroup({ className, ...props }: RadioGroupProps) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid gap-2.5', className)}
      {...props}
    />
  )
}

type RadioGroupIndicatorProps = React.ComponentProps<
  typeof RadioGroupPrimitive.Indicator
> & {
  transition: Transition
}

function RadioGroupIndicator({
  className,
  transition,
  ...props
}: RadioGroupIndicatorProps) {
  return (
    <RadioGroupPrimitive.Indicator
      data-slot="radio-group-indicator"
      className={cn('flex items-center justify-center', className)}
      {...props}
    >
      <AnimatePresence>
        <motion.div
          key="radio-group-indicator-circle"
          data-slot="radio-group-indicator-circle"
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0 }}
          transition={transition}
        >
          <Circle className="size-3 fill-current text-current" />
        </motion.div>
      </AnimatePresence>
    </RadioGroupPrimitive.Indicator>
  )
}

type RadioGroupItemProps = React.ComponentProps<
  typeof RadioGroupPrimitive.Item
> &
  HTMLMotionProps<'button'> & {
    transition?: Transition
  }

function RadioGroupItem({
  className,
  transition = { type: 'spring', stiffness: 200, damping: 16 },
  ...props
}: RadioGroupItemProps) {
  return (
    <RadioGroupPrimitive.Item asChild {...props}>
      <motion.button
        data-slot="radio-group-item"
        className={cn(
          'border-input text-primary ring-offset-background focus-visible:ring-ring flex aspect-square size-5 items-center justify-center rounded-full border focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        {...props}
      >
        <RadioGroupIndicator
          data-slot="radio-group-item-indicator"
          transition={transition}
        />
      </motion.button>
    </RadioGroupPrimitive.Item>
  )
}

export {
  RadioGroup,
  RadioGroupItem,
  type RadioGroupItemProps,
  type RadioGroupProps,
}
