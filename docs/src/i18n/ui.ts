/**
 * Supported languages with their display names.
 */
export const languages = {
  en: "English",
  ja: "日本語",
  zh: "中文",
  ko: "한국어",
  es: "Español",
  fr: "Français",
} as const;

/**
 * Default language code used when no language is specified or detected.
 */
export const defaultLang = "en";

/**
 * Union type of all supported language codes.
 */
export type Lang = keyof typeof languages;

/**
 * Extracts the language code from a URL pathname.
 *
 * Parses the URL to extract the first path segment after the base path
 * and validates it against supported languages. Returns the default
 * language if no valid language is found.
 *
 * @param url - The URL object to parse
 * @returns The detected language code, or defaultLang if not found
 *
 * @example
 * ```ts
 * const url = new URL('https://example.com/ja/page');
 * getLangFromUrl(url); // Returns 'ja'
 * ```
 */
export function getLangFromUrl(url: URL): Lang {
  const basePath = import.meta.env.BASE_URL;
  const pathWithoutBase = url.pathname.replace(
    new RegExp(`^${basePath}/?`),
    "/",
  );
  const [, lang] = pathWithoutBase.split("/");
  if (lang in languages) return lang as Lang;
  return defaultLang;
}

/**
 * Retrieves a nested value from an object using a key path.
 *
 * Traverses the object hierarchy using the provided keys array.
 * Returns undefined if any key in the path does not exist.
 *
 * @param obj - The object to traverse
 * @param keys - Array of keys representing the path to the value
 * @returns The nested value, or undefined if not found
 *
 * @internal
 */
function getNestedValue(obj: Record<string, unknown>, keys: string[]): unknown {
  let value: unknown = obj;
  for (const k of keys) {
    if (typeof value === "object" && value !== null && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return undefined;
    }
  }
  return value;
}

/**
 * Creates a translation function for the specified language.
 *
 * Returns a function that accepts dot-notation keys to retrieve
 * translated strings. Automatically falls back to English if
 * the key is not found in the specified language.
 *
 * @param lang - The language code to use for translations
 * @returns A translation function that accepts a key and returns the translated string
 *
 * @example
 * ```ts
 * const t = useTranslations('ja');
 * t('hero.title'); // Returns 'Bilibili動画ダウンローダー'
 * ```
 */
export function useTranslations(lang: Lang) {
  return function t(key: string): string {
    const keys = key.split(".");
    const value = getNestedValue(translations[lang], keys);
    if (typeof value === "string") return value;

    // Fallback to English if translation not found
    const fallbackValue = getNestedValue(translations[defaultLang], keys);
    return typeof fallbackValue === "string" ? fallbackValue : key;
  };
}

/**
 * Generates a localized path by prefixing the language code.
 *
 * For the default language (English), returns the path unchanged.
 * For other languages, prepends the language code to the path.
 *
 * @param path - The base path (e.g., '/faq')
 * @param lang - The target language code
 * @returns The localized path with language prefix
 *
 * @example
 * ```ts
 * getLocalizedPath('/faq', 'ja'); // Returns '/ja/faq'
 * getLocalizedPath('/faq', 'en'); // Returns '/faq'
 * ```
 */
export function getLocalizedPath(path: string, lang: Lang): string {
  return lang === defaultLang ? path : `/${lang}${path}`;
}

// 翻訳データ（UI用）
const translations: Record<Lang, Record<string, unknown>> = {
  en: {
    nav: {
      home: "Home",
      faq: "FAQ",
    },
    hero: {
      title: "Bilibili Video Downloader",
      description: "Download videos from Bilibili with ease",
      download: "Download Now",
    },
    features: {
      title: "Features",
      hoverHint: "Hover for details",
      list: {
        download: "Video & Audio Download",
        quality: "Multiple Quality Options",
        subtitle: "Subtitle Download",
        cdn: "Fast & Stable Downloads",
        batch: "Batch Download",
        bangumi: "Anime & Drama Support",
        hires: "Hi-Res Audio",
        adfree: "Ad-free",
      },
      descriptions: {
        download:
          "Save your favorite videos and music from Bilibili to watch offline anytime, anywhere.",
        quality:
          "Choose from 360p to 4K quality. Pick the best quality for your device and internet speed.\nMaximum quality depends on your Bilibili membership level.",
        subtitle:
          "Download subtitles in up to 15 languages. Choose soft subtitles as separate files or hard-burn them into the video.",
        cdn: "Automatically selects the fastest server for you. No more waiting on slow downloads.",
        batch:
          "Download multiple videos at once. Just paste multiple links and let the app do the rest.",
        bangumi:
          "Download official Bilibili content including anime, dramas, and variety shows.",
        hires:
          "Dolby Atmos and Hi-Res Lossless audio quality support for the best listening experience.\nRequires Bilibili Premium membership.",
        adfree: "No ads, no tracking, completely free.",
      },
    },
    download: {
      title: "Download",
      button: "Download",
      windows: "Windows",
      macos: "macOS",
      macosArm: "macOS (Apple Silicon)",
      macosIntel: "macOS (Intel)",
      linux: "Linux",
      comingSoon: "Coming Soon",
    },
    footer: {
      copyright: "© 2024 Bilibili Downloader GUI",
    },
  },
  ja: {
    nav: {
      home: "ホーム",
      faq: "よくある質問",
    },
    hero: {
      title: "Bilibili動画ダウンローダー",
      description: "Bilibiliから動画を簡単にダウンロード",
      download: "今すぐダウンロード",
    },
    features: {
      title: "機能",
      hoverHint: "詳細を見る",
      list: {
        download: "動画・音声ダウンロード",
        quality: "複数の画質オプション",
        subtitle: "字幕ダウンロード",
        cdn: "高速・安定ダウンロード",
        batch: "一括ダウンロード",
        bangumi: "アニメ・ドラマ対応",
        hires: "ハイレゾ音声",
        adfree: "広告なし",
      },
      descriptions: {
        download:
          "お気に入りの動画や音楽をBilibiliから保存して、いつでもどこでもオフラインで視聴できます。",
        quality:
          "360pから4Kまで選べる画質。端末やインターネット速度に合わせて最適な画質を選べます。\n利用可能な最高画質はBilibiliの会員ランクによって異なります。",
        subtitle:
          "最大15言語の字幕をダウンロード。字幕別ファイル（soft）または動画埋め込み（hard）を選択可能。",
        cdn: "最も高速なサーバーを自動で選択。遅いダウンロードで待たされるストレスから解放されます。",
        batch:
          "複数の動画をまとめてダウンロード。リンクを複数貼り付けるだけで、あとはアプリにおまかせ。",
        bangumi:
          "Bilibiliの公式コンテンツ（アニメ、ドラマ、バラエティ番組など）をダウンロード。",
        hires:
          "Dolby Atmos、Hi-Res Lossless対応。最高品質の音声で楽しめます。\n利用にはBilibiliプレミアム会員が必要です。",
        adfree: "広告なし、トラッキングなし、完全無料。",
      },
    },
    download: {
      title: "ダウンロード",
      button: "ダウンロード",
      windows: "Windows",
      macos: "macOS",
      macosArm: "macOS (Apple Silicon)",
      macosIntel: "macOS (Intel)",
      linux: "Linux",
      comingSoon: "近日対応予定",
    },
    footer: {
      copyright: "© 2024 Bilibili Downloader GUI",
    },
  },
  zh: {
    nav: {
      home: "首页",
      faq: "常见问题",
    },
    hero: {
      title: "Bilibili视频下载器",
      description: "轻松下载Bilibili视频",
      download: "立即下载",
    },
    features: {
      title: "功能",
      hoverHint: "悬停查看详情",
      list: {
        download: "视频和音频下载",
        quality: "多种画质选项",
        subtitle: "字幕下载",
        cdn: "高速稳定下载",
        batch: "批量下载",
        bangumi: "番剧支持",
        hires: "高解析度音频",
        adfree: "无广告",
      },
      descriptions: {
        download: "从Bilibili保存您喜爱的视频和音乐，随时随地离线观看。",
        quality:
          "从360p到4K画质任您选择。根据您的设备和网络速度选择最佳画质。\n最高可用画质取决于您的Bilibili会员等级。",
        subtitle:
          "支持最多15种语言的字幕下载。可选择软字幕（独立文件）或硬字幕（嵌入视频）。",
        cdn: "自动选择最快的下载服务器。告别漫长的等待。",
        batch: "批量下载多个视频。只需粘贴多个链接，剩下的交给应用即可。",
        bangumi: "下载Bilibili番剧，包括动漫、电视剧和综艺等官方内容。",
        hires:
          "支持 Dolby Atmos 和 Hi-Res Lossless，享受最高品质音频。\n需要Bilibili大会员。",
        adfree: "无广告、无追踪、完全免费。",
      },
    },
    download: {
      title: "下载",
      button: "下载",
      windows: "Windows",
      macos: "macOS",
      macosArm: "macOS (Apple Silicon)",
      macosIntel: "macOS (Intel)",
      linux: "Linux",
      comingSoon: "即将支持",
    },
    footer: {
      copyright: "© 2024 Bilibili Downloader GUI",
    },
  },
  ko: {
    nav: {
      home: "홈",
      faq: "자주 묻는 질문",
    },
    hero: {
      title: "Bilibili 비디오 다운로더",
      description: "Bilibili에서 비디오를 쉽게 다운로드",
      download: "지금 다운로드",
    },
    features: {
      title: "기능",
      hoverHint: "상세 정보 보기",
      list: {
        download: "비디오 및 오디오 다운로드",
        quality: "다양한 화질 옵션",
        subtitle: "자막 다운로드",
        cdn: "빠르고 안정적인 다운로드",
        batch: "일괄 다운로드",
        bangumi: "애니메이션・드라마 지원",
        hires: "하이레즈 오디오",
        adfree: "광고 없음",
      },
      descriptions: {
        download:
          "Bilibili에서 좋아하는 비디오와 음악을 저장하여 언제 어디서나 오프라인으로 시청하세요.",
        quality:
          "360p부터 4K까지 선택 가능. 기기와 인터넷 속도에 맞는 최적의 화질을 선택하세요.\n이용 가능한 최고 화질은 Bilibili 회원 등급에 따라 다릅니다.",
        subtitle:
          "최대 15개 언어 자막을 다운로드하세요. 소프트 자막(별도 파일) 또는 하드 자막(비디오 내장) 선택 가능.",
        cdn: "가장 빠른 서버를 자동으로 선택해 드립니다. 느린 다운로드로 기다릴 필요가 없습니다.",
        batch:
          "여러 비디오를 한 번에 다운로드하세요. 여러 링크만 붙여넣으면 나머지는 앱이 알아서 처리합니다.",
        bangumi:
          "Bilibili 공식 콘텐츠(애니메이션, 드라마, 예능 프로그램 등)를 다운로드하세요.",
        hires:
          "Dolby Atmos, Hi-Res Lossless 지원으로 최고 품질의 음향을 경험하세요.\nBilibili 프리미엄 회원이 필요합니다.",
        adfree: "광고 없음, 추적 없음, 완전 무료.",
      },
    },
    download: {
      title: "다운로드",
      button: "다운로드",
      windows: "Windows",
      macos: "macOS",
      macosArm: "macOS (Apple Silicon)",
      macosIntel: "macOS (Intel)",
      linux: "Linux",
      comingSoon: "곧 지원 예정",
    },
    footer: {
      copyright: "© 2024 Bilibili Downloader GUI",
    },
  },
  es: {
    nav: {
      home: "Inicio",
      faq: "Preguntas frecuentes",
    },
    hero: {
      title: "Descargador de videos de Bilibili",
      description: "Descarga videos de Bilibili fácilmente",
      download: "Descargar ahora",
    },
    features: {
      title: "Características",
      hoverHint: "Pasa el cursor para más detalles",
      list: {
        download: "Descarga de video y audio",
        quality: "Múltiples opciones de calidad",
        subtitle: "Descarga de subtítulos",
        cdn: "Descargas rápidas y estables",
        batch: "Descarga por lotes",
        bangumi: "Soporte de anime y dramas",
        hires: "Audio de alta resolución",
        adfree: "Sin publicidad",
      },
      descriptions: {
        download:
          "Guarda tus videos y música favoritos de Bilibili para verlos sin conexión en cualquier momento y lugar.",
        quality:
          "Elige entre calidad de 360p a 4K. Selecciona la mejor calidad para tu dispositivo y velocidad de internet.\nLa calidad máxima disponible depende de tu nivel de membresía en Bilibili.",
        subtitle:
          "Descarga subtítulos en hasta 15 idiomas. Elige entre subtítulos suaves (archivos separados) o duros (incrustados en el video).",
        cdn: "Selecciona automáticamente el servidor más rápido para ti. Olvídate de las descargas lentas.",
        batch:
          "Descarga múltiples videos a la vez. Solo pega varios enlaces y deja que la aplicación haga el resto.",
        bangumi:
          "Descarga contenido oficial de Bilibili, incluyendo anime, dramas y programas de variedades.",
        hires:
          "Compatibilidad con Dolby Atmos y Hi-Res Lossless para la mejor experiencia de audio.\nRequiere membresía Premium de Bilibili.",
        adfree: "Sin anuncios, sin rastreo, completamente gratis.",
      },
    },
    download: {
      title: "Descargar",
      button: "Descargar",
      windows: "Windows",
      macos: "macOS",
      macosArm: "macOS (Apple Silicon)",
      macosIntel: "macOS (Intel)",
      linux: "Linux",
      comingSoon: "Próximamente",
    },
    footer: {
      copyright: "© 2024 Bilibili Downloader GUI",
    },
  },
  fr: {
    nav: {
      home: "Accueil",
      faq: "FAQ",
    },
    hero: {
      title: "Téléchargeur de vidéos Bilibili",
      description: "Téléchargez des vidéos de Bilibili facilement",
      download: "Télécharger maintenant",
    },
    features: {
      title: "Fonctionnalités",
      hoverHint: "Survolez pour plus de détails",
      list: {
        download: "Téléchargement vidéo et audio",
        quality: "Plusieurs options de qualité",
        subtitle: "Téléchargement de sous-titres",
        cdn: "Téléchargements rapides et stables",
        batch: "Téléchargement par lots",
        bangumi: "Support anime et dramas",
        hires: "Audio haute résolution",
        adfree: "Sans publicité",
      },
      descriptions: {
        download:
          "Enregistrez vos vidéos et musiques préférées de Bilibili pour les regarder hors ligne quand vous voulez.",
        quality:
          "Choisissez parmi des qualités de 360p à 4K. Sélectionnez la meilleure qualité pour votre appareil et votre connexion.\nLa qualité maximale disponible dépend de votre niveau d'abonnement Bilibili.",
        subtitle:
          "Téléchargez des sous-titres dans jusqu'à 15 langues. Choisissez entre sous-titres soft (fichiers séparés) ou hard (incrustés dans la vidéo).",
        cdn: "Sélectionne automatiquement le serveur le plus rapide pour vous. Finis les téléchargements lents.",
        batch:
          "Téléchargez plusieurs vidéos à la fois. Collez simplement plusieurs liens et laissez l'application faire le reste.",
        bangumi:
          "Téléchargez du contenu officiel Bilibili, y compris anime, dramas et émissions de variétés.",
        hires:
          "Prise en charge Dolby Atmos et Hi-Res Lossless pour une expérience audio optimale.\nNécessite un abonnement Premium Bilibili.",
        adfree: "Sans publicité, sans suivi, totalement gratuit.",
      },
    },
    download: {
      title: "Télécharger",
      button: "Télécharger",
      windows: "Windows",
      macos: "macOS",
      macosArm: "macOS (Apple Silicon)",
      macosIntel: "macOS (Intel)",
      linux: "Linux",
      comingSoon: "Bientôt disponible",
    },
    footer: {
      copyright: "© 2024 Bilibili Downloader GUI",
    },
  },
};
