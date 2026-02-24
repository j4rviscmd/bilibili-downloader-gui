"use client";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/animate-ui/components/radix/hover-card";
import * as React from "react";

/**
 * Props for the FeatureCard component.
 */
interface FeatureCardProps {
  /** Emoji icon to display */
  icon: string;
  /** Feature title */
  title: string;
  /** Detailed description shown in hover content */
  description: string;
  /** Hint text shown below title (defaults to "Hover for details") */
  hoverHint?: string;
  /** Shows "Coming Soon" badge when true */
  comingSoon?: boolean;
}

/**
 * Badge component for "Coming Soon" indicator.
 */
function ComingSoonBadge() {
  return (
    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-300">
      Coming Soon
    </span>
  );
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
  hoverHint = "Hover for details",
  comingSoon = false,
}: FeatureCardProps): React.ReactElement {
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <div className="cursor-pointer rounded-lg border bg-card p-6 text-center text-card-foreground shadow-sm transition-all hover:border-primary/50 hover:shadow-md">
          <div className="text-4xl">{icon}</div>
          <h3 className="mt-4 font-semibold">
            {title}
            {comingSoon && <ComingSoonBadge />}
          </h3>
          <p className="mt-2 text-xs text-muted-foreground">{hoverHint}</p>
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="w-72" sideOffset={8}>
        <div className="flex justify-between gap-4">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">
              {title}
              {comingSoon && <ComingSoonBadge />}
            </h4>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <span className="shrink-0 text-2xl">{icon}</span>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
