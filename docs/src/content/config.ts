import { defineCollection, z } from "astro:content";

const faq = defineCollection({
  type: "data",
  schema: z.object({
    items: z.array(
      z.object({
        question: z.string(),
        answer: z.string(),
      }),
    ),
  }),
});

export const collections = { faq };
