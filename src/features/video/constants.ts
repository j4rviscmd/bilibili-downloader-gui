// map
export const VIDEO_QUALITIES_MAP: Record<number, string> = {
  116: '1080p60',
  74: '720p60',
  112: '1080p+',
  80: '1080p',
  64: '720p',
  32: '480p',
  16: '360p',
}

export const VIDEO_URL_KEY: string = 'inputUrl'

export const AUDIO_QUALITIES_MAP: Record<number, string> = {
  30216: '64K',
  30232: '132K',
  30280: '192K',
  30250: 'Dolby Atmos',
  30251: 'Hi-Res Lossless',
}

// Explicit display ordering (descending quality).
// Order: Hi-Res Lossless > Dolby Atmos > 192K > 132K > 64K
export const AUDIO_QUALITIES_ORDER: number[] = [
  30251, 30250, 30280, 30232, 30216,
]
