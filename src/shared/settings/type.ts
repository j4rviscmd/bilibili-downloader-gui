export type Settings = {
  // TODO: outputPathをjson管理
  // outputPath: string
  language: SupportedLang
  // Frontendのみの管理につき、localStorageでのみ保存している
  // TODO: themeをjson管理
  // theme: 'light' | 'dark'
}

export type SupportedLang = 'en' | 'ja' | 'fr' | 'es' | 'zh' | 'ko'
export type Language = {
  label: string
  id: SupportedLang
}
