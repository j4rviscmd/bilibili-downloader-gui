'use client'

import { motion, type Variants } from 'motion/react'

import {
  getVariants,
  IconWrapper,
  useAnimateIconContext,
  type IconProps,
} from '@/shared/animate-ui/icons/icon'

type DownloadProps = IconProps<keyof typeof animations>

const animations = {
  default: {
    group: {
      initial: { y: 0 },
      animate: {
        y: 2,
        transition: { duration: 0.3, ease: 'easeInOut' },
      },
    },
  } satisfies Record<string, Variants>,
  'default-loop': {
    group: {
      initial: { y: 0 },
      animate: {
        y: [0, 2, 0],
        transition: { duration: 0.6, ease: 'easeInOut' },
      },
    },
  } satisfies Record<string, Variants>,
} as const

/**
 * Internal download icon component with animation support.
 *
 * Renders a download arrow icon with animated downward movement.
 * The icon consists of a vertical line, arrowhead, and tray line,
 * all animated using Framer Motion variants.
 *
 * @param size - Icon size in pixels (default from IconWrapper)
 * @param props - Additional SVG and animation props
 */
function IconComponent({ size, ...props }: DownloadProps) {
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
        <motion.path d="M12 15V3" />
        <motion.path d="m7 10 5 5 5-5" />
      </motion.g>
      <motion.path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    </motion.svg>
  )
}

/**
 * Animated download icon.
 *
 * Displays a download arrow icon that animates on hover or tap.
 * Supports downward movement animation.
 *
 * @example
 * ```tsx
 * // Animate on hover
 * <Download animateOnHover={true} />
 *
 * // Custom size
 * <Download size={32} animateOnHover={true} />
 * ```
 */
function Download(props: DownloadProps) {
  return <IconWrapper icon={IconComponent} {...props} />
}

export {
  animations,
  Download,
  Download as DownloadIcon,
  type DownloadProps as DownloadIconProps,
  type DownloadProps,
}
