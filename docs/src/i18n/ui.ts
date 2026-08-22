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
  // Why: the site deploys to GitHub Pages under a base path (see `base` in
  // astro.config.mjs), so the base must be stripped before the first real
  // path segment can be read as the locale
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
    // Caution: a key missing in both the target language and English renders
    // the raw dot-notation key to users with no build-time error; per the
    // CLAUDE.md i18n rule, new keys must be added to all 6 languages
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
  // Constraint: astro.config.mjs sets prefixDefaultLocale: false, so English
  // pages live at the site root; prefixing "en" would produce a 404 link
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
        localTools: "Local MP4 Tools",
        bilibili: "Bilibili Integration",
        autoupdate: "Auto-update",
        adfree: "Ad-free",
      },
      descriptions: {
        download:
          "Save your favorite videos and music from Bilibili to watch offline anytime, anywhere.",
        quality:
          "Choose from 360p to 4K quality. Pick the best quality for your device and internet speed.\nMaximum quality depends on your Bilibili membership level.",
        subtitle:
          "Download subtitles in up to 15 languages. Choose soft subtitles as separate files or hard-burn them into the video. AI-generated subtitles are also supported.",
        cdn: "Automatically selects the fastest server for you, with automatic retry on network errors. No more waiting on slow downloads.",
        batch:
          "Download all parts of a multi-part video at once — pick the episodes you want from courses and series.",
        bangumi:
          "Download official Bilibili content including anime, dramas, and variety shows.",
        hires:
          "Dolby Atmos and Hi-Res Lossless audio quality support for the best listening experience.\nRequires Bilibili Premium membership.",
        localTools:
          "Trim — lossless stream copy or re-encode\nConcat — merge multiple MP4 files (auto re-encode on codec mismatch)\nAudio Extract — export audio to MP3/M4A with bitrate presets",
        bilibili:
          "Browse and download from your favorites and watch history, and auto-expand b23.tv short links.",
        autoupdate:
          "Built-in updater with signed release verification and release notes.",
        adfree: "No ads, no tracking, completely free.",
      },
    },
    download: {
      title: "Download",
      button: "Download",
      windows: "Windows",
      linux: "Linux",
      comingSoon: "Coming Soon",
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
        localTools: "ローカルMP4ツール",
        bilibili: "Bilibili連携",
        autoupdate: "自動アップデート",
        adfree: "広告なし",
      },
      descriptions: {
        download:
          "お気に入りの動画や音楽をBilibiliから保存して、いつでもどこでもオフラインで視聴できます。",
        quality:
          "360pから4Kまで選べる画質。端末やインターネット速度に合わせて最適な画質を選べます。\n利用可能な最高画質はBilibiliの会員ランクによって異なります。",
        subtitle:
          "最大15言語の字幕をダウンロード。字幕別ファイル（soft）または動画埋め込み（hard）を選択可能。AI生成字幕にも対応。",
        cdn: "最も高速なサーバーを自動で選択。ネットワークエラー時は自動でリトライします。遅いダウンロードで待たされるストレスから解放されます。",
        batch:
          "シリーズや講座など、1本の動画の複数パートをまとめてダウンロード。欲しいエピソードだけ選べます。",
        bangumi:
          "Bilibiliの公式コンテンツ（アニメ、ドラマ、バラエティ番組など）をダウンロード。",
        hires:
          "Dolby Atmos、Hi-Res Lossless対応。最高品質の音声で楽しめます。\n利用にはBilibiliプレミアム会員が必要です。",
        localTools:
          "トリム — ロスレスコピーまたは再エンコードで切り抜き\n結合 — 複数MP4を1つに統合（コーデック不一致時は再エンコード）\n音声抽出 — MP3/M4Aで書き出し、ビットレート選択可能",
        bilibili:
          "お気に入りや視聴履歴の参照とダウンロード、b23.tv短縮URLの自動展開に対応。",
        autoupdate: "署名検証付きのアップデーターとリリースノートを内蔵。",
        adfree: "広告なし、トラッキングなし、完全無料。",
      },
    },
    download: {
      title: "ダウンロード",
      button: "ダウンロード",
      windows: "Windows",
      linux: "Linux",
      comingSoon: "近日対応予定",
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
        localTools: "本地 MP4 工具",
        bilibili: "Bilibili 集成",
        autoupdate: "自动更新",
        adfree: "无广告",
      },
      descriptions: {
        download: "从Bilibili保存您喜爱的视频和音乐，随时随地离线观看。",
        quality:
          "从360p到4K画质任您选择。根据您的设备和网络速度选择最佳画质。\n最高可用画质取决于您的Bilibili会员等级。",
        subtitle:
          "支持最多15种语言的字幕下载。可选择软字幕（独立文件）或硬字幕（嵌入视频）。也支持AI生成字幕。",
        cdn: "自动选择最快的下载服务器，网络错误时自动重试。告别漫长的等待。",
        batch:
          "一次性下载多P视频的各分P——课程、系列等内容，可自由勾选想要的剧集。",
        bangumi: "下载Bilibili番剧，包括动漫、电视剧和综艺等官方内容。",
        hires:
          "支持 Dolby Atmos 和 Hi-Res Lossless，享受最高品质音频。\n需要Bilibili大会员。",
        localTools:
          "剪辑 — 无损流复制或重编码\n合并 — 将多个 MP4 合并为一个（编码不匹配时自动重编码）\n提取音频 — 导出为 MP3/M4A，可选比特率",
        bilibili: "浏览并下载收藏夹和观看历史，并自动展开 b23.tv 短链接。",
        autoupdate: "内置带签名验证的更新器和发布说明。",
        adfree: "无广告、无追踪、完全免费。",
      },
    },
    download: {
      title: "下载",
      button: "下载",
      windows: "Windows",
      linux: "Linux",
      comingSoon: "即将支持",
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
        localTools: "로컬 MP4 도구",
        bilibili: "Bilibili 연동",
        autoupdate: "자동 업데이트",
        adfree: "광고 없음",
      },
      descriptions: {
        download:
          "Bilibili에서 좋아하는 비디오와 음악을 저장하여 언제 어디서나 오프라인으로 시청하세요.",
        quality:
          "360p부터 4K까지 선택 가능. 기기와 인터넷 속도에 맞는 최적의 화질을 선택하세요.\n이용 가능한 최고 화질은 Bilibili 회원 등급에 따라 다릅니다.",
        subtitle:
          "최대 15개 언어 자막을 다운로드하세요. 소프트 자막(별도 파일) 또는 하드 자막(비디오 내장) 선택 가능. AI 생성 자막도 지원합니다.",
        cdn: "가장 빠른 서버를 자동으로 선택하며, 네트워크 오류 시 자동으로 재시도합니다. 느린 다운로드로 기다릴 필요가 없습니다.",
        batch:
          "시리즈·강좌 등 한 편의 영상에 포함된 여러 파트를 한 번에 다운로드. 원하는 에피소드만 골라 담을 수 있습니다.",
        bangumi:
          "Bilibili 공식 콘텐츠(애니메이션, 드라마, 예능 프로그램 등)를 다운로드하세요.",
        hires:
          "Dolby Atmos, Hi-Res Lossless 지원으로 최고 품질의 음향을 경험하세요.\nBilibili 프리미엄 회원이 필요합니다.",
        localTools:
          "자르기 — 무손실 스트림 복사 또는 재인코딩\n병합 — 여러 MP4를 하나로 통합(코덱 불일치 시 자동 재인코딩)\n오디오 추출 — MP3/M4A로 내보내기, 비트레이트 선택 가능",
        bilibili:
          "즐겨찾기와 시청 기록을 탐색하고 다운로드할 수 있으며, b23.tv 단축 URL을 자동으로 확장합니다.",
        autoupdate: "서명 검증 업데이터와 릴리스 노트를 내장했습니다.",
        adfree: "광고 없음, 추적 없음, 완전 무료.",
      },
    },
    download: {
      title: "다운로드",
      button: "다운로드",
      windows: "Windows",
      linux: "Linux",
      comingSoon: "곧 지원 예정",
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
        localTools: "Herramientas locales de MP4",
        bilibili: "Integración con Bilibili",
        autoupdate: "Actualización automática",
        adfree: "Sin publicidad",
      },
      descriptions: {
        download:
          "Guarda tus videos y música favoritos de Bilibili para verlos sin conexión en cualquier momento y lugar.",
        quality:
          "Elige entre calidad de 360p a 4K. Selecciona la mejor calidad para tu dispositivo y velocidad de internet.\nLa calidad máxima disponible depende de tu nivel de membresía en Bilibili.",
        subtitle:
          "Descarga subtítulos en hasta 15 idiomas. Elige entre subtítulos suaves (archivos separados) o duros (incrustados en el video). También se admiten subtítulos generados por IA.",
        cdn: "Selecciona automáticamente el servidor más rápido para ti, con reintento automático ante errores de red. Olvídate de las descargas lentas.",
        batch:
          "Descarga a la vez todas las partes de un vídeo multiparte: selecciona los episodios que quieras de cursos y series.",
        bangumi:
          "Descarga contenido oficial de Bilibili, incluyendo anime, dramas y programas de variedades.",
        hires:
          "Compatibilidad con Dolby Atmos y Hi-Res Lossless para la mejor experiencia de audio.\nRequiere membresía Premium de Bilibili.",
        localTools:
          "Recortar — copia de flujo sin pérdida o recodificación\nCombinar — une varios MP4 en uno (recodificación automática si hay inconsistencia de códec)\nExtracción de audio — exporta a MP3/M4A con preajustes de bitrate",
        bilibili:
          "Explora y descarga desde tus favoritos y tu historial de visualización, y expande automáticamente los enlaces cortos de b23.tv.",
        autoupdate:
          "Actualizador integrado con verificación de versiones firmadas y notas de versión.",
        adfree: "Sin anuncios, sin rastreo, completamente gratis.",
      },
    },
    download: {
      title: "Descargar",
      button: "Descargar",
      windows: "Windows",
      linux: "Linux",
      comingSoon: "Próximamente",
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
        localTools: "Outils MP4 locaux",
        bilibili: "Intégration Bilibili",
        autoupdate: "Mise à jour automatique",
        adfree: "Sans publicité",
      },
      descriptions: {
        download:
          "Enregistrez vos vidéos et musiques préférées de Bilibili pour les regarder hors ligne quand vous voulez.",
        quality:
          "Choisissez parmi des qualités de 360p à 4K. Sélectionnez la meilleure qualité pour votre appareil et votre connexion.\nLa qualité maximale disponible dépend de votre niveau d'abonnement Bilibili.",
        subtitle:
          "Téléchargez des sous-titres dans jusqu'à 15 langues. Choisissez entre sous-titres soft (fichiers séparés) ou hard (incrustés dans la vidéo). Les sous-titres générés par IA sont également pris en charge.",
        cdn: "Sélectionne automatiquement le serveur le plus rapide pour vous, avec réessai automatique en cas d'erreurs réseau. Finis les téléchargements lents.",
        batch:
          "Téléchargez en une fois toutes les parties d'une vidéo multi-parties : choisissez les épisodes souhaités parmi les cours et séries.",
        bangumi:
          "Téléchargez du contenu officiel Bilibili, y compris anime, dramas et émissions de variétés.",
        hires:
          "Prise en charge Dolby Atmos et Hi-Res Lossless pour une expérience audio optimale.\nNécessite un abonnement Premium Bilibili.",
        localTools:
          "Découpage — copie de flux sans perte ou réencodage\nFusion — regroupe plusieurs MP4 en un seul (réencodage automatique en cas d'incompatibilité de codec)\nExtraction audio — exportation en MP3/M4A avec présélection du débit binaire",
        bilibili:
          "Parcourez et téléchargez depuis vos favoris et votre historique de visionnage, et développez automatiquement les liens courts b23.tv.",
        autoupdate:
          "Metteur à jour intégré avec vérification des versions signées et notes de version.",
        adfree: "Sans publicité, sans suivi, totalement gratuit.",
      },
    },
    download: {
      title: "Télécharger",
      button: "Télécharger",
      windows: "Windows",
      linux: "Linux",
      comingSoon: "Bientôt disponible",
    },
  },
};
