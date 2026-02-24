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
  icon: string;
  title: string;
  description: string;
  hoverHint?: string;
  comingSoon?: boolean;
  isNew?: boolean;
}

/** Base badge style classes */
const BADGE_BASE = "ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium";

/**
 * Badge component for "Coming Soon" indicator.
 */
function ComingSoonBadge(): React.ReactElement {
  return (
    <span
      className={`${BADGE_BASE} bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300`}
    >
      Coming Soon
    </span>
  );
}

/**
 * Badge component for "New" indicator.
 */
function NewBadge(): React.ReactElement {
  return (
    <span
      className={`${BADGE_BASE} bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300`}
    >
      New
    </span>
  );
}

/** Renders title with optional badges */
function TitleWithBadges({
  title,
  isNew,
  comingSoon,
  as: Component = "h3",
}: {
  title: string;
  isNew?: boolean;
  comingSoon?: boolean;
  as?: React.ElementType;
}): React.ReactElement {
  return (
    <Component className="font-semibold">
      {title}
      {isNew && <NewBadge />}
      {comingSoon && <ComingSoonBadge />}
    </Component>
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
  isNew = false,
}: FeatureCardProps): React.ReactElement {
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <div className="cursor-pointer rounded-lg border bg-card p-6 text-center text-card-foreground shadow-sm transition-all hover:border-primary/50 hover:shadow-md">
          <div className="text-4xl">{icon}</div>
          <div className="mt-4">
            <TitleWithBadges
              title={title}
              isNew={isNew}
              comingSoon={comingSoon}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{hoverHint}</p>
        </div>
      </HoverCardTrigger>
      <HoverCardContent className="w-72" sideOffset={8}>
        <div className="flex justify-between gap-4">
          <div className="space-y-1">
            <TitleWithBadges
              title={title}
              isNew={isNew}
              comingSoon={comingSoon}
              as="h4"
            />
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <span className="shrink-0 text-2xl">{icon}</span>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
