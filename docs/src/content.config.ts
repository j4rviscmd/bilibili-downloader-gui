import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// Why: Astro v6 removed the legacy Content Collections API, so the FAQ data
// collection uses the Content Layer `glob()` loader. Basing the glob directly
// on the faq directory makes entry ids the plain yaml file stems ("en", "ja",
// ...) which keeps the existing getCollection filters in pages unchanged.
const faq = defineCollection({
  loader: glob({ pattern: "*.yaml", base: "./src/content/faq" }),
  schema: z.object({
    items: z.array(
      z.object({
        question: z.string(),
        answer: z.string(),
      }),
    ),
  }),
});

// Markdown how-to/comparison guides, one file per locale:
// src/content/guides/<lang>/<slug>.md (entry id = "<lang>/<slug>")
const guides = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/guides" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updated: z.coerce.date().optional(),
    keywords: z.array(z.string()).default([]),
    order: z.number().default(99),
  }),
});

export const collections = { faq, guides };
