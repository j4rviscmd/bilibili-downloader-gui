'use client'

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/animate-ui/components/radix/hover-card'
import * as React from 'react'

/**
 * Props for the FeatureCard component.
 */
interface FeatureCardProps {
  /** Emoji icon to display */
  icon: string
  /** Feature title */
  title: string
  /** Detailed description shown in hover content */
  description: string
  /** Hint text shown below title (defaults to "Hover for details") */
  hoverHint?: string
}

/**
 * FeatureCard - A card component with hover-revealed details.
 *
 * Displays a card with an icon, title, and hint text. When hovered,
 * shows a popover with the full description. Uses HoverCard for
 * accessibility and smooth animations.
 */
export function FeatureCard({
  icon,
  title,
  description,
  hoverHint = 'Hover for details',
}: FeatureCardProps): React.ReactElement {
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <div className="bg-card text-card-foreground hover:border-primary/50 cursor-pointer rounded-lg border p-6 text-center shadow-sm transition-all hover:shadow-md">
          <div className="text-4xl">{icon}</div>
          <h3 className="mt-4 font-semibold">{title}</h3>
          <p className="text-muted-foreground mt-2 text-xs">{hoverHint}</p>
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="w-72" sideOffset={8}>
        <div className="flex justify-between gap-4">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">{title}</h4>
            <p className="text-muted-foreground text-sm">{description}</p>
          </div>
          <span className="shrink-0 text-2xl">{icon}</span>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
