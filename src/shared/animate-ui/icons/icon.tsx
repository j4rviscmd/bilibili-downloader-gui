'use client'

import {
  useAnimation,
  type LegacyAnimationControls,
  type SVGMotionProps,
  type Variants,
} from 'motion/react'
import * as React from 'react'

import { cn } from '@/shared/lib/utils'

const staticAnimations = {
  path: {
    initial: { pathLength: 1, opacity: 1 },
    animate: {
      pathLength: [0.05, 1],
      opacity: [0, 1],
      transition: {
        duration: 0.8,
        ease: 'easeInOut',
        opacity: { duration: 0.01 },
      },
    },
  } as Variants,
  'path-loop': {
    initial: { pathLength: 1, opacity: 1 },
    animate: {
      pathLength: [1, 0.05, 1],
      opacity: [1, 0, 1],
      transition: {
        duration: 1.6,
        ease: 'easeInOut',
        opacity: { duration: 0.01 },
      },
    },
  } as Variants,
} as const

type StaticAnimations = keyof typeof staticAnimations
type TriggerProp<T = string> = boolean | StaticAnimations | T

interface AnimateIconContextValue {
  controls: LegacyAnimationControls | undefined
  animation: StaticAnimations | string
  loop: boolean
  loopDelay: number
}

interface DefaultIconProps<T = string> {
  animate?: TriggerProp<T>
  onAnimateChange?: (
    value: boolean,
    animation: StaticAnimations | string,
  ) => void
  animateOnHover?: TriggerProp<T>
  animateOnTap?: TriggerProp<T>
  animation?: T | StaticAnimations
  loop?: boolean
  loopDelay?: number
  onAnimateStart?: () => void
  onAnimateEnd?: () => void
}

interface AnimateIconProps<T = string> extends DefaultIconProps<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children: React.ReactElement<any, any>
}

interface IconProps<T>
  extends DefaultIconProps<T>,
    Omit<
      SVGMotionProps<SVGSVGElement>,
      'animate' | 'onAnimationStart' | 'onAnimationEnd'
    > {
  size?: number
}

interface IconWrapperProps<T> extends IconProps<T> {
  icon: React.ComponentType<IconProps<T>>
}

/**
 * Context for managing animated icon state.
 *
 * Provides shared animation controls, animation type, and loop settings
 * to nested icon components.
 */
const AnimateIconContext = React.createContext<AnimateIconContextValue | null>(
  null,
)

/**
 * Hook to access the animated icon context.
 *
 * Returns default values if used outside of an AnimateIconProvider.
 *
 * @returns The icon animation context value with defaults applied
 *
 * @example
 * ```tsx
 * const { controls, animation, loop, loopDelay } = useAnimateIconContext()
 * ```
 */
function useAnimateIconContext() {
  const context = React.useContext(AnimateIconContext)
  if (!context)
    return {
      controls: undefined,
      animation: 'default',
      loop: false,
      loopDelay: 0,
    }
  return context
}

/**
 * Provider wrapper for animating icons on user interaction.
 *
 * Manages animation state for child icon components, triggering animations
 * on hover, tap/click, or controlled state changes.
 *
 * @example
 * ```tsx
 * // Animate on hover
 * <AnimateIcon animateOnHover="path">
 *   <MyIcon />
 * </AnimateIcon>
 *
 * // Controlled animation
 * <AnimateIcon animate={isPlaying} animation="spin">
 *   <PlayIcon />
 * </AnimateIcon>
 * ```
 */
function AnimateIcon({
  animate,
  onAnimateChange,
  animateOnHover,
  animateOnTap,
  animation = 'default',
  loop = false,
  loopDelay = 0,
  onAnimateStart,
  onAnimateEnd,
  children,
}: AnimateIconProps) {
  const controls = useAnimation()
  const [localAnimate, setLocalAnimate] = React.useState(!!animate)
  const currentAnimation = React.useRef(animation)

  const startAnimation = React.useCallback(
    (trigger: TriggerProp) => {
      currentAnimation.current =
        typeof trigger === 'string' ? trigger : animation
      setLocalAnimate(true)
    },
    [animation],
  )

  const stopAnimation = React.useCallback(() => {
    setLocalAnimate(false)
  }, [])

  React.useEffect(() => {
    currentAnimation.current = typeof animate === 'string' ? animate : animation
    setLocalAnimate(!!animate)
  }, [animate])

  React.useEffect(
    () => onAnimateChange?.(localAnimate, currentAnimation.current),
    [localAnimate, onAnimateChange],
  )

  React.useEffect(() => {
    if (localAnimate) onAnimateStart?.()
    controls.start(localAnimate ? 'animate' : 'initial').then(() => {
      if (localAnimate) onAnimateEnd?.()
    })
  }, [localAnimate, controls, onAnimateStart, onAnimateEnd])

  const handleMouseEnter = (e: MouseEvent) => {
    if (animateOnHover) startAnimation(animateOnHover)
    children.props?.onMouseEnter?.(e)
  }
  const handleMouseLeave = (e: MouseEvent) => {
    if (animateOnHover || animateOnTap) stopAnimation()
    children.props?.onMouseLeave?.(e)
  }
  const handlePointerDown = (e: PointerEvent) => {
    if (animateOnTap) startAnimation(animateOnTap)
    children.props?.onPointerDown?.(e)
  }
  const handlePointerUp = (e: PointerEvent) => {
    if (animateOnTap) stopAnimation()
    children.props?.onPointerUp?.(e)
  }

  const child = React.Children.only(children)
  const cloned = React.cloneElement(child, {
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
    onPointerDown: handlePointerDown,
    onPointerUp: handlePointerUp,
  })

  return (
    <AnimateIconContext.Provider
      value={{
        controls,
        animation: currentAnimation.current,
        loop,
        loopDelay,
      }}
    >
      {cloned}
    </AnimateIconContext.Provider>
  )
}

const pathClassName =
  "[&_[stroke-dasharray='1px_1px']]:![stroke-dasharray:1px_0px]"

/**
 * Wrapper component for creating animated icons.
 *
 * Automatically handles animation context inheritance and applies
 * appropriate variants based on the animation type. Supports size
 * customization and className merging.
 *
 * @example
 * ```tsx
 * // Standalone animated icon
 * <IconWrapper
 *   icon={SettingsIcon}
 *   animateOnHover={true}
 *   animation="rotate"
 *   size={24}
 * />
 *
 * // Inheriting from parent AnimateIcon
 * <AnimateIcon animateOnHover="path">
 *   <IconWrapper icon={HomeIcon} />
 * </AnimateIcon>
 * ```
 */
function IconWrapper<T extends string>({
  size = 28,
  animation: animationProp,
  animate,
  onAnimateChange,
  animateOnHover = false,
  animateOnTap = false,
  icon: IconComponent,
  loop = false,
  loopDelay = 0,
  onAnimateStart,
  onAnimateEnd,
  className,
  ...props
}: IconWrapperProps<T>) {
  const context = React.useContext(AnimateIconContext)

  if (context) {
    const {
      controls,
      animation: parentAnimation,
      loop: parentLoop,
      loopDelay: parentLoopDelay,
    } = context
    const animationToUse = animationProp ?? parentAnimation
    const loopToUse = loop || parentLoop
    const loopDelayToUse = loopDelay || parentLoopDelay

    return (
      <AnimateIconContext.Provider
        value={{
          controls,
          animation: animationToUse,
          loop: loopToUse,
          loopDelay: loopDelayToUse,
        }}
      >
        <IconComponent
          size={size}
          className={cn(
            className,
            (animationToUse === 'path' || animationToUse === 'path-loop') &&
              pathClassName,
          )}
          {...props}
        />
      </AnimateIconContext.Provider>
    )
  }

  if (
    animate !== undefined ||
    onAnimateChange !== undefined ||
    animateOnHover ||
    animateOnTap ||
    animationProp
  ) {
    return (
      <AnimateIcon
        animate={animate}
        onAnimateChange={onAnimateChange}
        animateOnHover={animateOnHover}
        animateOnTap={animateOnTap}
        animation={animationProp}
        loop={loop}
        loopDelay={loopDelay}
        onAnimateStart={onAnimateStart}
        onAnimateEnd={onAnimateEnd}
      >
        <IconComponent
          size={size}
          className={cn(
            className,
            (animationProp === 'path' || animationProp === 'path-loop') &&
              pathClassName,
          )}
          {...props}
        />
      </AnimateIcon>
    )
  }

  return (
    <IconComponent
      size={size}
      className={cn(
        className,
        (animationProp === 'path' || animationProp === 'path-loop') &&
          pathClassName,
      )}
      {...props}
    />
  )
}

/**
 * Gets animation variants with loop support applied.
 *
 * Retrieves the appropriate animation variants based on the current
 * animation type from context. If loop is enabled, modifies the
 * transition properties to include infinite repetition.
 *
 * @param animations - Object containing animation variant definitions
 * @returns Variants object with loop modifications applied if needed
 *
 * @example
 * ```tsx
 * const animations = {
 *   default: { group: { initial: {}, animate: {} } },
 *   spin: { group: { initial: {}, animate: {} } }
 * }
 * const variants = getVariants(animations)
 * ```
 */
function getVariants<
  V extends { default: T; [key: string]: T },
  T extends Record<string, Variants>,
>(animations: V): T {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { animation: animationType, loop, loopDelay } = useAnimateIconContext()

  let result: T

  if (animationType in staticAnimations) {
    const variant = staticAnimations[animationType as StaticAnimations]
    result = {} as T
    for (const key in animations.default) {
      if (
        (animationType === 'path' || animationType === 'path-loop') &&
        key.includes('group')
      )
        continue
      result[key] = variant as T[Extract<keyof T, string>]
    }
  } else {
    result = (animations[animationType as keyof V] as T) ?? animations.default
  }

  if (loop) {
    for (const key in result) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state = result[key] as any
      const transition = state.animate?.transition
      if (!transition) continue

      const hasNestedKeys = Object.values(transition).some(
        (v) =>
          typeof v === 'object' &&
          v !== null &&
          ('ease' in v || 'duration' in v || 'times' in v),
      )

      if (hasNestedKeys) {
        for (const prop in transition) {
          const subTrans = transition[prop]
          if (typeof subTrans === 'object' && subTrans !== null) {
            transition[prop] = {
              ...subTrans,
              repeat: Infinity,
              repeatType: 'loop',
              repeatDelay: loopDelay,
            }
          }
        }
      } else {
        state.animate.transition = {
          ...transition,
          repeat: Infinity,
          repeatType: 'loop',
          repeatDelay: loopDelay,
        }
      }
    }
  }

  return result
}

export {
  AnimateIcon,
  getVariants,
  IconWrapper,
  pathClassName,
  staticAnimations,
  useAnimateIconContext,
  type AnimateIconContextValue,
  type AnimateIconProps,
  type IconProps,
  type IconWrapperProps,
}
