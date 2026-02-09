'use client'

import { motion, type Variants } from 'motion/react'

import {
  getVariants,
  IconWrapper,
  useAnimateIconContext,
  type IconProps,
} from '@/shared/animate-ui/icons/icon'

type SettingsProps = IconProps<keyof typeof animations>

/**
 * Animation variants for the settings gear icon.
 *
 * Available animations:
 * - 'default': Rotates 180 degrees with easing
 * - 'default-loop': Rotates 360 degrees continuously
 * - 'rotate': Continuous linear rotation
 */
const animations = {
  default: {
    group: {
      initial: {
        rotate: 0,
      },
      animate: {
        rotate: [0, 90, 180],
        transition: {
          duration: 1.25,
          ease: 'easeInOut',
        },
      },
    },
    path: {},
    circle: {},
  } satisfies Record<string, Variants>,
  'default-loop': {
    group: {
      initial: {
        rotate: 0,
      },
      animate: {
        rotate: [0, 90, 180, 270, 360],
        transition: {
          duration: 2.5,
          ease: 'easeInOut',
          repeat: Infinity,
          repeatType: 'loop',
        },
      },
    },
    path: {},
    circle: {},
  } satisfies Record<string, Variants>,
  rotate: {
    group: {
      initial: {
        rotate: 0,
      },
      animate: {
        rotate: 360,
        transition: {
          duration: 2,
          ease: 'linear',
          repeat: Infinity,
          repeatType: 'loop',
        },
      },
    },
    path: {},
    circle: {},
  } satisfies Record<string, Variants>,
} as const

/**
 * Internal settings icon component with animation support.
 *
 * Renders a gear/cog icon with animated rotation. The icon consists
 * of a path (gear shape) and a circle (center hole), both animated
 * using Framer Motion variants.
 *
 * @param size - Icon size in pixels (default from IconWrapper)
 * @param props - Additional SVG and animation props
 *
 * @example
 * ```tsx
 * <IconComponent size={24} animate={true} />
 * ```
 */
function IconComponent({ size, ...props }: SettingsProps) {
  const { controls } = useAnimateIconContext()
  const variants = getVariants(animations)

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <motion.g variants={variants.group} initial="initial" animate={controls}>
        <motion.path
          d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
          variants={variants.path}
          initial="initial"
          animate={controls}
        />
        <motion.circle
          cx={12}
          cy={12}
          r={3}
          variants={variants.circle}
          initial="initial"
          animate={controls}
        />
      </motion.g>
    </motion.svg>
  )
}

/**
 * Animated settings gear icon.
 *
 * Displays a gear/cog icon that can animate on hover or tap.
 * Supports multiple animation types including rotation and spinning.
 *
 * @example
 * ```tsx
 * // Animate on hover
 * <Settings animateOnHover={true} />
 *
 * // Continuous rotation
 * <Settings animateOnHover={true} animation="rotate" />
 *
 * // Custom size
 * <Settings size={32} animateOnHover={true} />
 * ```
 */
function Settings(props: SettingsProps) {
  return <IconWrapper icon={IconComponent} {...props} />
}

export {
  animations,
  Settings,
  Settings as SettingsIcon,
  type SettingsProps as SettingsIconProps,
  type SettingsProps,
}
