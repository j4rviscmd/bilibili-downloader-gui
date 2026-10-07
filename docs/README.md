# Marketing Site (Astro)

Source of the GitHub Pages site at
<https://j4rviscmd.github.io/bilibili-downloader-gui/>. Deploys automatically
via `.github/workflows/docs.yml` on pushes to `main` that touch `docs/**`.

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## SEO

### SEO assertion script

`scripts/check-seo.mjs` asserts the built output (`dist/`): localized
titles/descriptions, single `<h1>`, robots.txt, FAQPage/Article/
BreadcrumbList JSON-LD, hreflang clusters, sitemap coverage, and internal
links. Run it after every content or template change:

```sh
npm run build && node scripts/check-seo.mjs
```

### Content rules (guides)

- Guide markdown lives in `src/content/guides/<lang>/<slug>.md`; every
  locale must ship all slugs (the script fails otherwise)
- Hub and comparison titles carry the current year — refresh it every
  January and bump the `updated` frontmatter field (the year is also
  asserted in `scripts/check-seo.mjs`; bump it there in the same change or
  the check fails)
- Competing apps are referred to by initials only ("Tool A" etc.). Never
  name real competitor products, companies, or URLs in guide content
- All UI strings (including `meta.*` page titles) must exist in all six
  locales in `src/i18n/ui.ts`

### Search Console setup (one-time, manual)

1. Open <https://search.google.com/search-console> and add a URL-prefix
   property for `https://j4rviscmd.github.io/bilibili-downloader-gui/`.
2. Choose the **HTML file** verification method and download the
   `google<code>.html` file.
3. Copy it to `docs/public/` and merge — GitHub Pages serves it at the
   site root once the docs workflow deploys.
4. Back in Search Console, verify and submit the sitemap
   `sitemap-index.xml`.
5. Set up <https://www.bing.com/webmasters> via "Import from Google
   Search Console".

Monthly: record average position and CTR for the target keywords
(ja: bilibili ダウンロード / bilibili ダウンローダー). Rewrite titles of
queries with impressions but no clicks. Refresh the year token in hub and
comparison guide titles every January.

## Original Astro starter notes

The sections below are from the Astro minimal starter template.
