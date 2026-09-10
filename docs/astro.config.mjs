// @ts-check
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  site: "https://j4rviscmd.github.io",
  base: "/bilibili-downloader-gui",
  integrations: [react(), sitemap()],
  i18n: {
    defaultLocale: "en",
    locales: ["en", "ja", "zh", "ko", "es", "fr"],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  // Why: @astrojs/tailwind is deprecated and incompatible with Astro v6+;
  // Tailwind v4 integrates through the Vite plugin instead.
  vite: {
    plugins: [tailwindcss()],
  },
});
