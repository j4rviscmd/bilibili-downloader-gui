export type Input = {
  url: string
  title: string
  quality: string
}

export type Video = {
  title: string
  bvid: string
  parts: VideoPart[]
}

export type VideoPart = {
  part: string
  page: number
  cid: number
  duration: number
  qualities: VideoQuality[]
  thumbnail: Thumbnail
}
export type Thumbnail = {
  url: string
  base64: string
}

export type VideoQuality = {
  quality: string
  id: number
}
