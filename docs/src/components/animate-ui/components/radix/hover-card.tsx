import {
  HoverCardContent as HoverCardContentPrimitive,
  HoverCardPortal as HoverCardPortalPrimitive,
  HoverCard as HoverCardPrimitive,
  HoverCardTrigger as HoverCardTriggerPrimitive,
  type HoverCardContentProps as HoverCardContentPrimitiveProps,
  type HoverCardProps as HoverCardPrimitiveProps,
  type HoverCardTriggerProps as HoverCardTriggerPrimitiveProps,
} from "@/components/animate-ui/primitives/radix/hover-card";
import { cn } from "@/lib/utils";

export type HoverCardProps = HoverCardPrimitiveProps;
export type HoverCardTriggerProps = HoverCardTriggerPrimitiveProps;
export type HoverCardContentProps = HoverCardContentPrimitiveProps;

export function HoverCard(props: HoverCardProps) {
  return <HoverCardPrimitive {...props} />;
}

export function HoverCardTrigger(props: HoverCardTriggerProps) {
  return <HoverCardTriggerPrimitive {...props} />;
}

export function HoverCardContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: HoverCardContentProps) {
  return (
    <HoverCardPortalPrimitive>
      <HoverCardContentPrimitive
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "origin-(--radix-hover-card-content-transform-origin) outline-hidden z-50 w-64 rounded-md border bg-popover p-4 text-popover-foreground shadow-md",
          className,
        )}
        {...props}
      />
    </HoverCardPortalPrimitive>
  );
}
