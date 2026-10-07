// SEO assertions against the built site (dist/).
// Usage: cd docs && npm run build && node scripts/check-seo.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
// Note: must stay in sync with `site` + `base` in astro.config.mjs — the
// canonical and sitemap assertions compare these exact URLs
const SITE = "https://j4rviscmd.github.io/bilibili-downloader-gui";
const locales = ["en", "ja", "zh", "ko", "es", "fr"];
// Each localized index/faq <title> must contain its locale keyword.
const titleKeyword = {
  en: "Bilibili Video Downloader",
  ja: "ダウンローダー",
  zh: "视频下载器",
  ko: "다운로더",
  es: "Descargador",
  fr: "Téléchargeur",
};

let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failures++;
};
const read = (...p) => {
  try {
    return readFileSync(join(dist, ...p), "utf8");
  } catch {
    return null;
  }
};
// English pages live at the site root, other locales under <loc>/
const page = (loc, ...path) => read(...(loc === "en" ? path : [loc, ...path]));
const titleOf = (html) => html?.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";

const descOf = (html) =>
  html?.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";

// --- Section: robots.txt ---
const robots = read("robots.txt");
check(
  "robots.txt exists with sitemap reference",
  !!robots?.includes(`Sitemap: ${SITE}/sitemap-index.xml`),
);

// --- Section: index pages (title / description / single h1) ---
for (const loc of locales) {
  const html = page(loc, "index.html");
  check(`index ${loc}: html exists`, !!html);
  if (!html) continue;

  check(
    `index ${loc}: localized title`,
    titleOf(html).includes(titleKeyword[loc]),
  );
  check(
    `index ${loc}: description >= 60 chars (${descOf(html).length})`,
    descOf(html).length >= 60,
  );
  check(
    `index ${loc}: exactly one h1`,
    (html.match(/<h1/g) ?? []).length === 1,
  );
}

// --- Section: FAQPage structured data (added Task 3) ---
for (const loc of locales) {
  const html = page(loc, "faq", "index.html");
  check(`faq ${loc}: FAQPage JSON-LD`, !!html?.includes('"@type":"FAQPage"'));
  check(
    `faq ${loc}: >= 11 Question entities (6 base + 5 keyword-targeted)`,
    (html?.match(/"@type":"Question"/g) ?? []).length >= 11,
  );
}

// --- Section: internal links to guides (added Task 8) ---
for (const loc of locales) {
  const html = page(loc, "index.html");
  check(
    `index ${loc}: links to hub guide`,
    !!html?.includes(`guides/how-to-download`),
  );
  check(
    `index ${loc}: nav guides link (#guides anchor)`,
    !!html?.includes(`#guides`),
  );
  check(`index ${loc}: FAQ link`, !!html?.match(/href="[^"]*\/faq\/?"/));
}

// --- Section: faq pages (title) ---
for (const loc of locales) {
  const html = page(loc, "faq", "index.html");
  check(`faq ${loc}: html exists`, !!html);
  if (html)
    check(
      `faq ${loc}: localized title (non-empty, locale keyword)`,
      titleOf(html).includes(titleKeyword[loc]),
    );
}

// --- Section: guides (added Task 4; all 5 slugs x 6 locales from Task 6) ---
const guideSlugs = [
  "how-to-download",
  "best-downloaders",
  "download-with-subtitles",
  "download-bangumi-batch",
  "download-mp3-audio",
];
const guideUrl = (loc, slug) =>
  `${SITE}/${loc === "en" ? "" : `${loc}/`}guides/${slug}/`;
const readGuide = (loc, slug) => page(loc, "guides", slug, "index.html");
for (const loc of locales) {
  for (const slug of guideSlugs) {
    const g = readGuide(loc, slug);
    check(`guide ${loc}/${slug}: exists`, !!g);
    if (!g) continue;
    check(
      `guide ${loc}/${slug}: Article + BreadcrumbList JSON-LD`,
      g.includes('"@type":"Article"') && g.includes('"@type":"BreadcrumbList"'),
    );
    check(
      `guide ${loc}/${slug}: 7 hreflang links (6 locales + x-default)`,
      (g.match(/hreflang="/g) ?? []).length === 7,
    );
    const expectedCanonical = guideUrl(loc, slug);
    check(
      `guide ${loc}/${slug}: canonical ${expectedCanonical}`,
      g.includes(`rel="canonical" href="${expectedCanonical}"`),
    );
    // Language switcher must keep the same guide path (Review Focus 2):
    // all 6 locale options carry the same slug.
    check(
      `guide ${loc}/${slug}: lang switcher preserves slug`,
      (g.match(new RegExp(`value="[^"]*guides/${slug}/"`, "g")) ?? [])
        .length === 6,
    );
  }
}
// Sitemap must contain every guide URL
const sitemap = read("sitemap-0.xml") ?? "";
for (const loc of locales) {
  for (const slug of guideSlugs) {
    const u = guideUrl(loc, slug);
    check(`sitemap: ${u}`, sitemap.includes(`<loc>${u}</loc>`));
  }
}

// --- Section: content depth + year token (added Task 6) ---
for (const loc of locales) {
  const hub = readGuide(loc, "how-to-download");
  const cmp = readGuide(loc, "best-downloaders");
  check(`hub ${loc}: >= 7 h2 sections`, (hub?.match(/<h2/g) ?? []).length >= 7);
  check(`cmp ${loc}: >= 6 h2 sections`, (cmp?.match(/<h2/g) ?? []).length >= 6);
  check(`cmp ${loc}: comparison table present`, !!cmp?.includes("<table"));
  // Why: the title year is a freshness signal — every January bump the guide
  // titles + `updated` frontmatter and this token in the same change
  // (docs/README.md "Content rules")
  check(`hub ${loc}: year token in title`, !!hub?.match(/<title>[^<]*2026/));
  check(`cmp ${loc}: year token in title`, !!cmp?.match(/<title>[^<]*2026/));
}

console.log(failures ? `\n${failures} FAILURES` : "\nALL PASS");
process.exit(failures ? 1 : 0);
