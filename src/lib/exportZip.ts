import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'

import type { PromptProject } from '../features/promptStudio'
import type { CanvasDocument } from '../features/canvas/types'
import type { AgentConversation, AppSettings, ExportData, FavoriteCollection, StoredImage, StoredImageThumbnail, StoredVideo, TaskRecord } from '../types'
import { bytesToDataUrl, dataUrlToBytes } from './dataUrl'
import { getNumberedFileNameBase, sanitizeFileNamePart } from './exportFileName'
import { addAgentImageReferences, addCanvasImageReferences, addPromptProjectImageReferences, addTaskImageReferences } from './imageReferences'

type ZipFiles = Record<string, Uint8Array | [Uint8Array, { mtime: Date }]>

export interface BuildExportZipOptions {
  exportConfig?: boolean
  exportTasks?: boolean
  exportPromptProjects?: boolean
}

export interface BuildExportZipParams {
  options: BuildExportZipOptions
  exportedAt: number
  settings: AppSettings
  tasks: TaskRecord[]
  images: StoredImage[]
  videos?: Array<{ record: StoredVideo, bytes: Uint8Array }>
  thumbnailsByImageId: Map<string, StoredImageThumbnail>
  favoriteCollections: FavoriteCollection[]
  defaultFavoriteCollectionId: string | null
  agentConversations: AgentConversation[]
  promptProjects: PromptProject[]
  canvasDocuments?: CanvasDocument[]
}

export interface ExportZipContents {
  manifest: ExportData
  files: Record<string, Uint8Array>
}

export function buildExportZip(params: BuildExportZipParams) {
  const exportedAtDate = new Date(params.exportedAt)
  const exportedTasks = params.options.exportTasks ? params.tasks : []
  const exportedConversations = params.options.exportTasks ? params.agentConversations : []
  const exportedProjects = params.options.exportPromptProjects ? params.promptProjects : []
  const exportedCanvasDocuments = params.options.exportTasks ? params.canvasDocuments ?? [] : []
  const imageIds = getExportImageIds(exportedTasks, exportedConversations, exportedProjects)
  addCanvasImageReferences(imageIds, exportedCanvasDocuments)
  const imageCreatedAtFallback = getImageCreatedAtFallback(exportedTasks, exportedProjects)
  const imageFileNameBases = getImageFileNameBases(exportedTasks, exportedProjects)
  const imageFiles: ExportData['imageFiles'] = {}
  const thumbnailFiles: NonNullable<ExportData['thumbnailFiles']> = {}
  const videoFiles: NonNullable<ExportData['videoFiles']> = {}
  const zipFiles: ZipFiles = {}
  const usedImagePaths = new Set<string>()

  if (params.options.exportTasks || params.options.exportPromptProjects) {
    for (const img of params.images) {
      if (!imageIds.has(img.id)) continue
      const { ext, bytes } = dataUrlToBytes(img.dataUrl)
      const path = getUniqueImagePath(imageFileNameBases.get(img.id) || `image-${img.id}`, ext, usedImagePaths)
      const pathBase = path.slice('images/'.length, -(ext.length + 1))
      const createdAt = img.createdAt ?? imageCreatedAtFallback.get(img.id) ?? params.exportedAt
      imageFiles[img.id] = {
        path,
        createdAt,
        source: img.source,
        sourceImageId: img.sourceImageId,
        width: img.width,
        height: img.height,
      }
      zipFiles[path] = [bytes, { mtime: new Date(createdAt) }]

      const thumbnail = params.thumbnailsByImageId.get(img.id)
      if (thumbnail?.thumbnailDataUrl) {
        const { ext: thumbnailExt, bytes: thumbnailBytes } = dataUrlToBytes(thumbnail.thumbnailDataUrl)
        const thumbnailPath = `thumbnails/${pathBase}.${thumbnailExt}`
        imageFiles[img.id].width = imageFiles[img.id].width ?? thumbnail.width
        imageFiles[img.id].height = imageFiles[img.id].height ?? thumbnail.height
        thumbnailFiles[img.id] = {
          path: thumbnailPath,
          width: thumbnail.width,
          height: thumbnail.height,
          thumbnailVersion: thumbnail.thumbnailVersion,
        }
        zipFiles[thumbnailPath] = [thumbnailBytes, { mtime: new Date(createdAt) }]
      }
    }
  }

  if (params.options.exportTasks) {
    const videoIds = new Set(params.tasks.flatMap((task) => task.outputVideoIds || []))
    for (const item of params.videos || []) {
      if (!videoIds.has(item.record.id)) continue
      const ext = item.record.name.split('.').pop() || 'mp4'
      const base = sanitizeFileNamePart(item.record.name.replace(/\.[^.]+$/, '')) || 'video'
      const path = `videos/${base}-${sanitizeFileNamePart(item.record.id)}.${ext}`
      videoFiles[item.record.id] = {
        path,
        name: item.record.name,
        mimeType: item.record.mimeType,
        duration: item.record.duration,
        width: item.record.width,
        height: item.record.height,
        createdAt: item.record.createdAt,
      }
      zipFiles[path] = [item.bytes, { mtime: new Date(item.record.createdAt) }]
    }
  }

  const manifest: ExportData = {
    version: 4,
    exportedAt: exportedAtDate.toISOString(),
  }

  if (params.options.exportConfig) manifest.settings = params.settings
  if (params.options.exportTasks) {
    manifest.tasks = params.tasks
    manifest.favoriteCollections = params.favoriteCollections
    manifest.defaultFavoriteCollectionId = params.defaultFavoriteCollectionId
    manifest.agentConversations = params.agentConversations
    manifest.canvasDocuments = params.canvasDocuments ?? []
    manifest.imageFiles = imageFiles
    manifest.thumbnailFiles = thumbnailFiles
    manifest.videoFiles = videoFiles
  }
  if (params.options.exportPromptProjects) {
    manifest.promptProjects = params.promptProjects
    manifest.imageFiles = imageFiles
    manifest.thumbnailFiles = thumbnailFiles
  }

  zipFiles['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { mtime: exportedAtDate }]

  return {
    manifest,
    bytes: zipSync(zipFiles, { level: 6 }),
  }
}

export function readExportZip(bytes: Uint8Array): ExportZipContents {
  const files = unzipSync(bytes)
  const manifestBytes = files['manifest.json']
  if (!manifestBytes) throw new Error('ZIP 中缺少 manifest.json')

  return {
    manifest: JSON.parse(strFromU8(manifestBytes)) as ExportData,
    files,
  }
}

export function readExportZipFileAsDataUrl(files: Record<string, Uint8Array>, path: string): string | null {
  const bytes = files[path]
  if (!bytes) return null
  return bytesToDataUrl(bytes, path)
}

function getImageCreatedAtFallback(tasks: TaskRecord[], projects: PromptProject[]) {
  const imageCreatedAtFallback = new Map<string, number>()

  for (const task of tasks) {
    for (const id of [
      ...(task.inputImageIds || []),
      ...(task.maskImageId ? [task.maskImageId] : []),
      ...(task.outputImages || []),
      ...(task.transparentOriginalImages || []),
      ...(task.streamPartialImageIds || []),
    ]) {
      if (!id) continue
      const prev = imageCreatedAtFallback.get(id)
      if (prev == null || task.createdAt < prev) imageCreatedAtFallback.set(id, task.createdAt)
    }
  }

  for (const project of projects) {
    for (const asset of project.source.assets || []) {
      const prev = imageCreatedAtFallback.get(asset.id)
      if (prev == null || project.createdAt < prev) imageCreatedAtFallback.set(asset.id, project.createdAt)
    }
  }

  return imageCreatedAtFallback
}

function getImageFileNameBases(tasks: TaskRecord[], projects: PromptProject[]) {
  const bases = new Map<string, string>()

  for (const task of tasks) addImageFileNameBases(bases, task.outputImages || [], `task-${task.id}`)
  for (const task of tasks) addImageFileNameBases(bases, task.transparentOriginalImages || [], `task-${task.id}-orig`)
  for (const task of tasks) addImageFileNameBases(bases, task.streamPartialImageIds || [], `task-${task.id}-partial`)
  for (const task of tasks) addImageFileNameBases(bases, task.inputImageIds || [], `task-${task.id}-input`)
  for (const task of tasks) {
    if (task.maskImageId && !bases.has(task.maskImageId)) bases.set(task.maskImageId, `task-${task.id}-mask`)
  }
  for (const project of projects) {
    const assets = project.source.assets || []
    for (let index = 0; index < assets.length; index++) {
      const asset = assets[index]
      if (bases.has(asset.id)) continue
      const label = asset.label || `asset-${index + 1}`
      bases.set(asset.id, `prompt-${project.id}-${label}`)
    }
  }

  return bases
}

function getExportImageIds(tasks: TaskRecord[], conversations: AgentConversation[], projects: PromptProject[]) {
  const ids = new Set<string>()
  for (const task of tasks) addTaskImageReferences(ids, task)
  addAgentImageReferences(ids, conversations)
  addPromptProjectImageReferences(ids, projects)
  return ids
}

function addImageFileNameBases(bases: Map<string, string>, imageIds: string[], fileNameBase: string) {
  const ids = imageIds.filter(Boolean)
  for (let index = 0; index < ids.length; index++) {
    if (bases.has(ids[index])) continue
    bases.set(ids[index], getNumberedFileNameBase(fileNameBase, index, ids.length))
  }
}

function getUniqueImagePath(fileNameBase: string, ext: string, usedPaths: Set<string>) {
  const base = sanitizeFileNamePart(fileNameBase) || 'image'
  let path = `images/${base}.${ext}`
  let duplicateIndex = 2
  while (usedPaths.has(path)) {
    path = `images/${base}-${String(duplicateIndex).padStart(2, '0')}.${ext}`
    duplicateIndex++
  }
  usedPaths.add(path)
  return path
}
