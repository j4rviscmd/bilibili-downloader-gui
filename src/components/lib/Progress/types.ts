export type Progress = {
  downloadId: string
  filesize: number // in MB
  downloaded: number // in MB
  transferRate: number // in MB/s
  percentage: number // in %
  elapsedTime: number // cumulative seconds
  isComplete: boolean
  stage?: string
  parentId?: string
  internalId?: string
}
