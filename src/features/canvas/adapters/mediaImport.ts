// 把本地文件导入为画布可引用的资产（图片/视频），只入库、不产生任务卡。
import { fileToDataUrl } from '../../../lib/dataUrl'
import { putVideo, storeImageWithSize } from '../../../lib/db'
import { genId } from '../../../lib/id'
import { cacheImage } from '../../imageLibrary'

export type ImportedCanvasImage = {
  imageId: string
  width?: number
  height?: number
}

export type ImportedCanvasVideo = {
  videoId: string
  posterImageId?: string
  width: number
  height: number
}

export async function importCanvasImageFile(file: File): Promise<ImportedCanvasImage | null> {
  if (!file.type.startsWith('image/')) return null
  const dataUrl = await fileToDataUrl(file)
  const stored = await storeImageWithSize(dataUrl, 'upload')
  cacheImage(stored.id, dataUrl)
  return { imageId: stored.id, width: stored.width, height: stored.height }
}

export async function importCanvasVideoFile(file: File): Promise<ImportedCanvasVideo | null> {
  if (!file.type.startsWith('video/')) return null
  const meta = await probeVideoFile(file)
  const videoId = genId()
  await putVideo({
    id: videoId,
    blob: file,
    name: file.name,
    mimeType: file.type || 'video/mp4',
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    createdAt: Date.now(),
  })

  let posterImageId: string | undefined
  if (meta.posterDataUrl) {
    const poster = await storeImageWithSize(meta.posterDataUrl, 'upload')
    cacheImage(poster.id, meta.posterDataUrl)
    posterImageId = poster.id
  }
  return { videoId, posterImageId, width: meta.width, height: meta.height }
}

// 用隐藏 video 元素读取时长/尺寸并抓取 10% 处的封面帧。
function probeVideoFile(file: File) {
  return new Promise<{ duration: number; width: number; height: number; posterDataUrl?: string }>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.src = url

    const cleanup = () => {
      URL.revokeObjectURL(url)
      video.removeAttribute('src')
      video.load()
    }
    const finish = (posterDataUrl?: string) => {
      const result = {
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth || 1280,
        height: video.videoHeight || 720,
        posterDataUrl,
      }
      cleanup()
      resolve(result)
    }

    video.onerror = () => {
      cleanup()
      reject(new Error('视频加载失败'))
    }
    video.onloadedmetadata = () => {
      const target = Number.isFinite(video.duration) ? video.duration * 0.1 : 0
      video.currentTime = target
    }
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) return finish()
        ctx.drawImage(video, 0, 0)
        finish(canvas.toDataURL('image/jpeg', 0.85))
      } catch {
        finish()
      }
    }
  })
}
