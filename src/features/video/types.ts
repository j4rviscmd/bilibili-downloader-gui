export type Input = {
  url: string
  title: string
  quality: string
}

export type Video = {
  title: string
  bvid: string
  cid: number
  qualities: VideoQuality[]
}

export type VideoQuality = {
  quality: string
  id: number
}
