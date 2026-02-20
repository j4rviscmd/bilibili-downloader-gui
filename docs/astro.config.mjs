// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  site: 'https://j4rviscmd.github.io',
  base: '/bilibili-downloader-gui',
  integrations: [
    react(),
    sitemap(),
    tailwind(),
  ],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ja', 'zh', 'ko', 'es', 'fr'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
});
