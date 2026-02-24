"use client";

import * as React from "react";
import { FeatureCard } from "../ui/FeatureCard";

/**
 * Feature data structure.
 */
interface Feature {
  key: string;
  icon: string;
  title: string;
  description: string;
  comingSoon?: boolean;
  isNew?: boolean;
}

/**
 * Props for the FeaturesSection component.
 */
interface FeaturesSectionProps {
  title: string;
  hoverHint: string;
  features: Feature[];
}

/**
 * FeaturesSection - Displays a grid of feature cards.
 *
 * Renders a section with a title and a responsive grid of feature cards.
 * Each card shows an icon, title, and hover hint with detailed description.
 */
export function FeaturesSection({
  title,
  hoverHint,
  features,
}: FeaturesSectionProps): React.ReactElement {
  return (
    <section className="container mx-auto px-4 py-16">
      <h2 className="text-center text-3xl font-bold">{title}</h2>
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((feature) => (
          <FeatureCard
            key={feature.key}
            icon={feature.icon}
            title={feature.title}
            description={feature.description}
            hoverHint={hoverHint}
            comingSoon={feature.comingSoon}
            isNew={feature.isNew}
          />
        ))}
      </div>
    </section>
  );
}
