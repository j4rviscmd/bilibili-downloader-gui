/**
 * bilibili video zones (分区) for the video search filter and result badges.
 *
 * Source: references/bilibili-API-collect/docs/video/video_zone.md. Only the
 * 21 main zones are selectable (the bilibili search `tids` param filters by
 * main zone); result entries carry sub-zone tids, so `SUB_ZONE_PARENT` maps
 * them back to the parent for a consistent badge label.
 */

/** Selectable main zones (bilibili search-page order). */
export const SEARCH_ZONES: ReadonlyArray<{
  tid: number
  /** i18n key under `videoSearch.zones` (official zone code). */
  key: string
}> = [
  { tid: 1, key: 'douga' },
  { tid: 13, key: 'anime' },
  { tid: 167, key: 'guochuang' },
  { tid: 3, key: 'music' },
  { tid: 129, key: 'dance' },
  { tid: 4, key: 'game' },
  { tid: 36, key: 'knowledge' },
  { tid: 188, key: 'tech' },
  { tid: 234, key: 'sports' },
  { tid: 223, key: 'car' },
  { tid: 160, key: 'life' },
  { tid: 211, key: 'food' },
  { tid: 217, key: 'animal' },
  { tid: 119, key: 'kichiku' },
  { tid: 155, key: 'fashion' },
  { tid: 202, key: 'information' },
  { tid: 5, key: 'ent' },
  { tid: 181, key: 'cinephile' },
  { tid: 177, key: 'documentary' },
  { tid: 23, key: 'movie' },
  { tid: 11, key: 'tv' },
]

/** Main-zone tid → i18n key (derived from SEARCH_ZONES, never out of
 * sync). */
const ZONE_KEY_BY_TID: Readonly<Record<number, string>> = Object.fromEntries(
  SEARCH_ZONES.map((z) => [z.tid, z.key] as const),
)

/** Sub-zone (二级分区) tid → parent main-zone tid. Delisted zones are
 * omitted; unknown tids fall back to the raw `typename`. */
const SUB_ZONE_PARENT: Readonly<Record<number, number>> = {
  // 动画 douga (1)
  24: 1,
  25: 1,
  47: 1,
  257: 1,
  210: 1,
  86: 1,
  253: 1,
  27: 1,
  // 番剧 anime (13)
  51: 13,
  152: 13,
  32: 13,
  33: 13,
  // 国创 guochuang (167)
  153: 167,
  168: 167,
  169: 167,
  170: 167,
  195: 167,
  // 音乐 music (3)
  28: 3,
  29: 3,
  31: 3,
  59: 3,
  243: 3,
  30: 3,
  193: 3,
  266: 3,
  265: 3,
  267: 3,
  244: 3,
  130: 3,
  // 舞蹈 dance (129)
  20: 129,
  198: 129,
  199: 129,
  200: 129,
  255: 129,
  154: 129,
  156: 129,
  // 游戏 game (4)
  17: 4,
  171: 4,
  172: 4,
  65: 4,
  173: 4,
  121: 4,
  136: 4,
  19: 4,
  // 知识 knowledge (36)
  201: 36,
  124: 36,
  228: 36,
  207: 36,
  208: 36,
  209: 36,
  229: 36,
  122: 36,
  // 科技 tech (188)
  95: 188,
  230: 188,
  231: 188,
  232: 188,
  233: 188,
  // 运动 sports (234)
  235: 234,
  249: 234,
  164: 234,
  236: 234,
  237: 234,
  238: 234,
  // 汽车 car (223)
  258: 223,
  227: 223,
  247: 223,
  245: 223,
  246: 223,
  240: 223,
  248: 223,
  176: 223,
  // 生活 life (160)
  138: 160,
  254: 160,
  250: 160,
  251: 160,
  239: 160,
  161: 160,
  162: 160,
  21: 160,
  // 美食 food (211)
  76: 211,
  212: 211,
  213: 211,
  214: 211,
  215: 211,
  // 动物圈 animal (217)
  218: 217,
  219: 217,
  222: 217,
  221: 217,
  220: 217,
  75: 217,
  // 鬼畜 kichiku (119)
  22: 119,
  26: 119,
  126: 119,
  216: 119,
  127: 119,
  // 时尚 fashion (155)
  157: 155,
  252: 155,
  158: 155,
  159: 155,
  // 资讯 information (202)
  203: 202,
  204: 202,
  205: 202,
  206: 202,
  // 娱乐 ent (5)
  241: 5,
  262: 5,
  263: 5,
  242: 5,
  264: 5,
  137: 5,
  71: 5,
  // 影视 cinephile (181)
  182: 181,
  183: 181,
  260: 181,
  259: 181,
  184: 181,
  85: 181,
  256: 181,
  261: 181,
  // 纪录片 documentary (177)
  37: 177,
  178: 177,
  179: 177,
  180: 177,
  // 电影 movie (23)
  147: 23,
  145: 23,
  146: 23,
  83: 23,
  // 电视剧 tv (11)
  185: 11,
  187: 11,
}

/**
 * Zone i18n key for a result-card typeid: direct main zone, else the parent
 * of a sub zone. Null when the tid is unknown (delisted/new zones) — the
 * caller falls back to the raw `typename`.
 */
export function zoneKeyForTid(typeid: string): string | null {
  const tid = Number(typeid)
  if (!Number.isInteger(tid) || tid <= 0) return null
  const main = ZONE_KEY_BY_TID[tid]
  if (main !== undefined) return main
  const parent = SUB_ZONE_PARENT[tid]
  return parent !== undefined ? (ZONE_KEY_BY_TID[parent] ?? null) : null
}
