export type PartInput = {
  cid: number
  page: number
  title: string
  videoQuality: string
  audioQuality: string
  selected: boolean
}

export type Input = {
  url: string
  partInputs: PartInput[]
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
  videoQualities: VideoQuality[]
  audioQualities: AudioQuality[]
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

export type AudioQuality = {
  quality: string
  id: number
}
