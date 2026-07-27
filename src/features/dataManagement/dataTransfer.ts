import { migratePromptProject, type PromptProject } from '../promptStudio'
import { DEFAULT_PARAMS } from '../../types'
import { DEFAULT_SETTINGS, mergeImportedSettings } from '../../lib/apiProfiles'
import { syncSub2Settings } from '../../lib/sub2Profiles'
import {
  clearAgentConversations,
  clearCanvasDocuments,
  clearPromptProjects,
  clearTasks,
  clearVideos,
  getAllCanvasDocuments,
  getAllImageIds,
  getAllImages,
  getAllPromptProjects,
  getAllTasks,
  getAllVideos,
  getImageThumbnail,
  putCanvasDocument,
  putImage,
  putImageThumbnail,
  putPromptProject,
  putVideo,
} from '../../lib/db'
import { formatExportFileTime } from '../../lib/exportFileName'
import { buildExportZip, readExportZip, readExportZipFileAsDataUrl } from '../../lib/exportZip'
import { genId } from '../../lib/id'
import { addAgentImageReferences, addCanvasImageReferences, addPromptProjectImageReferences, addTaskImageReferences } from '../../lib/imageReferences'
import type { CanvasDocument } from '../canvas/types'
import { collectCanvasDocumentVideoIds, normalizeCanvasDocument } from '../canvas/core/documents'
import { isEmptyAgentConversation } from '../agent'
import {
  ensureDefaultFavoriteCollection,
  normalizeFavoriteCollections,
  normalizeLoadedFavoriteState,
  resolveDefaultFavoriteCollectionId,
} from '../favorites'
import { cacheImage, cacheThumbnail, scheduleThumbnailBackfill } from '../imageLibrary'
import { deleteUnreferencedImageIds, putTask, skipSupportPromptForImportedData } from '../tasks'
import { useStore } from '../../state/appStore'
import {
  getPersistableAgentConversations,
  mergeImportedAgentConversations,
  normalizeAgentConversations,
  replaceStoredAgentConversations,
} from '../../state/persistence'

export interface ClearOptions {
  clearConfig?: boolean
  clearTasks?: boolean
  clearPromptProjects?: boolean
}

export async function clearData(options: ClearOptions = { clearConfig: true, clearTasks: true, clearPromptProjects: true }) {
  const { setTasks, clearInputImages, clearMaskDraft, setSettings, setParams } = useStore.getState()
  const imageIds = new Set<string>()

  if (options.clearPromptProjects) {
    const projects = await getAllPromptProjects()
    addPromptProjectImageReferences(imageIds, projects)
    await clearPromptProjects()
  }

  if (options.clearTasks) {
    for (const id of await getAllImageIds()) imageIds.add(id)
    await clearTasks()
    await clearVideos()
    await clearAgentConversations()
    // 画布节点引用的图片/视频随任务数据一起清理，避免残留断链的画布文档。
    await clearCanvasDocuments()
    setTasks([])
    clearInputImages()
    clearMaskDraft()
    useStore.setState({
      agentConversations: [],
      activeAgentConversationId: null,
      agentInputDrafts: {},
      galleryInputDraft: null,
      supportPromptOpen: false,
      supportPromptSkippedForImportedData: false,
    })
  }

  await deleteUnreferencedImageIds(imageIds)

  if (options.clearConfig) {
    useStore.setState({ dismissedCodexCliPrompts: [], supportPromptDismissed: false })
    // 走 syncSub2Settings 保持 Sub2-only 不变量（sub2OnlyVersion/占位 profile/hybrid 模式），
    // 直接写 DEFAULT_SETTINGS 会把应用重置成非 Sub2 的 OpenAI 默认配置。
    setSettings(syncSub2Settings({ ...DEFAULT_SETTINGS }, [], new Map()))
    setParams({ ...DEFAULT_PARAMS })
  }
  // 成功/失败提示由调用方（设置弹窗）统一处理，失败时向上抛出。
}

export interface ExportOptions {
  exportConfig?: boolean
  exportTasks?: boolean
  exportPromptProjects?: boolean
}

export async function exportData(options: ExportOptions = { exportConfig: true, exportTasks: true, exportPromptProjects: true }) {
  try {
    const tasks = options.exportTasks ? await getAllTasks() : []
    const promptProjects = options.exportPromptProjects ? await getAllPromptProjects() : []
    const canvasDocuments = options.exportTasks ? await getAllCanvasDocuments() : []
    const { settings, agentConversations, favoriteCollections, defaultFavoriteCollectionId } = useStore.getState()
    const exportedAgentConversations = options.exportTasks ? getPersistableAgentConversations(agentConversations) : []
    const imageIds = new Set<string>()
    for (const task of tasks) addTaskImageReferences(imageIds, task)
    addAgentImageReferences(imageIds, exportedAgentConversations)
    addPromptProjectImageReferences(imageIds, promptProjects)
    addCanvasImageReferences(imageIds, canvasDocuments)
    const images = options.exportTasks || options.exportPromptProjects
      ? (await getAllImages()).filter((image) => imageIds.has(image.id))
      : []
    const videoIds = new Set(tasks.flatMap((task) => task.outputVideoIds || []))
    collectCanvasDocumentVideoIds(videoIds, canvasDocuments)
    const videos = options.exportTasks
      ? await Promise.all((await getAllVideos()).filter((record) => videoIds.has(record.id)).map(async (record) => ({ record, bytes: new Uint8Array(await record.blob.arrayBuffer()) })))
      : []
    const exportedAt = Date.now()
    const thumbnailsByImageId = new Map<string, NonNullable<Awaited<ReturnType<typeof getImageThumbnail>>>>()

    if (options.exportTasks || options.exportPromptProjects) {
      for (const img of images) {
        const thumbnail = await getImageThumbnail(img.id)
        if (!thumbnail?.thumbnailDataUrl) continue
        thumbnailsByImageId.set(img.id, thumbnail)
        cacheThumbnail(img.id, {
          dataUrl: thumbnail.thumbnailDataUrl,
          width: thumbnail.width,
          height: thumbnail.height,
          thumbnailVersion: thumbnail.thumbnailVersion,
        })
      }
    }

    const { bytes: zipped } = buildExportZip({
      options,
      exportedAt,
      settings,
      tasks,
      images,
      videos,
      thumbnailsByImageId,
      favoriteCollections,
      defaultFavoriteCollectionId,
      agentConversations: exportedAgentConversations,
      promptProjects,
      canvasDocuments,
    })
    const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gpt-image-playground-backup_${formatExportFileTime(new Date(exportedAt))}.zip`
    a.click()
    URL.revokeObjectURL(url)
    useStore.getState().showToast('数据已导出', 'success')
  } catch (err) {
    useStore.getState().showToast(`导出失败：${err instanceof Error ? err.message : String(err)}`, 'error')
  }
}

function mergeImportedPromptProjects(imported: PromptProject[], existing: PromptProject[]) {
  const usedIds = new Set(existing.map((project) => project.id))
  const idMap = new Map<string, string>()
  const projects = imported.map((project) => {
    const id = usedIds.has(project.id) ? `${project.id}-imported-${genId()}` : project.id
    usedIds.add(id)
    if (!idMap.has(project.id)) idMap.set(project.id, id)
    return id === project.id ? project : { ...project, id }
  })

  return projects.map((project) => {
    if (project.source.type !== 'project' || !project.source.id) return project
    const sourceId = idMap.get(project.source.id)
    if (!sourceId || sourceId === project.source.id) return project
    return { ...project, source: { ...project.source, id: sourceId } }
  })
}

export interface ImportOptions {
  importConfig?: boolean
  importTasks?: boolean
  importPromptProjects?: boolean
}

export async function importData(file: File, options: ImportOptions = { importConfig: true, importTasks: true, importPromptProjects: true }) {
  try {
    const buffer = await file.arrayBuffer()
    const { manifest: data, files } = readExportZip(new Uint8Array(buffer))
    const importedPromptProjects = options.importPromptProjects && data.promptProjects
      ? mergeImportedPromptProjects(data.promptProjects.map(migratePromptProject), await getAllPromptProjects())
      : []
    const importedCanvasDocuments: CanvasDocument[] = []
    if (options.importTasks && Array.isArray(data.canvasDocuments)) {
      const existingCanvasIds = new Set((await getAllCanvasDocuments()).map((doc) => doc.id))
      for (const raw of data.canvasDocuments) {
        const doc = normalizeCanvasDocument(raw)
        if (!doc) continue
        importedCanvasDocuments.push(existingCanvasIds.has(doc.id) ? { ...doc, id: `${doc.id}-imported-${genId()}` } : doc)
      }
    }
    const imageIds = new Set<string>()
    if (options.importTasks) {
      for (const task of data.tasks || []) addTaskImageReferences(imageIds, task)
      addAgentImageReferences(imageIds, data.agentConversations || [])
    }
    addPromptProjectImageReferences(imageIds, importedPromptProjects)
    addCanvasImageReferences(imageIds, importedCanvasDocuments)

    const importedImageIds: string[] = []
    if (data.imageFiles) {
      for (const [id, info] of Object.entries(data.imageFiles)) {
        if (!imageIds.has(id)) continue
        const dataUrl = readExportZipFileAsDataUrl(files, info.path)
        if (!dataUrl) continue
        await putImage({
          id,
          dataUrl,
          createdAt: info.createdAt,
          source: info.source,
          sourceImageId: info.sourceImageId,
          width: info.width,
          height: info.height,
        })
        cacheImage(id, dataUrl)
        importedImageIds.push(id)
      }

      for (const [id, info] of Object.entries(data.thumbnailFiles ?? {})) {
        if (!imageIds.has(id)) continue
        const thumbnailDataUrl = readExportZipFileAsDataUrl(files, info.path)
        if (!thumbnailDataUrl) continue
        await putImageThumbnail({
          id,
          thumbnailDataUrl,
          width: info.width,
          height: info.height,
          thumbnailVersion: info.thumbnailVersion,
        })
        cacheThumbnail(id, {
          dataUrl: thumbnailDataUrl,
          width: info.width,
          height: info.height,
          thumbnailVersion: info.thumbnailVersion,
        })
      }
    }

    if (options.importTasks && data.videoFiles) {
      for (const [id, info] of Object.entries(data.videoFiles)) {
        const bytes = files[info.path]
        if (!bytes) continue
        await putVideo({
          id,
          blob: new Blob([bytes.buffer as ArrayBuffer], { type: info.mimeType }),
          name: info.name,
          mimeType: info.mimeType,
          duration: info.duration,
          width: info.width,
          height: info.height,
          createdAt: info.createdAt,
        })
      }
    }

    if (options.importTasks && data.tasks) {
      for (const task of data.tasks) await putTask(task)

      const tasks = await getAllTasks()
      const state = useStore.getState()
      const importedCollections = normalizeFavoriteCollections(data.favoriteCollections)
      const favoriteCollections = importedCollections.length
        ? ensureDefaultFavoriteCollection(normalizeFavoriteCollections([...state.favoriteCollections, ...importedCollections]))
        : state.favoriteCollections
      const defaultFavoriteCollectionId = importedCollections.length
        ? resolveDefaultFavoriteCollectionId(favoriteCollections, data.defaultFavoriteCollectionId)
        : state.defaultFavoriteCollectionId
      const normalizedFavorites = normalizeLoadedFavoriteState(tasks, favoriteCollections, defaultFavoriteCollectionId)
      useStore.setState({
        tasks: normalizedFavorites.tasks,
        favoriteCollections: normalizedFavorites.collections,
        defaultFavoriteCollectionId: normalizedFavorites.defaultFavoriteCollectionId,
      })
      if (normalizedFavorites.changed) await Promise.all(normalizedFavorites.tasks.map((task) => putTask(task)))
      const importedAgentConversations = normalizeAgentConversations(data.agentConversations)
        .filter((conversation) => !isEmptyAgentConversation(conversation))
      useStore.setState((state) => {
        const agentConversations = mergeImportedAgentConversations(state.agentConversations, importedAgentConversations)
        const activeAgentConversationId = state.activeAgentConversationId && agentConversations.some((conversation) => conversation.id === state.activeAgentConversationId)
          ? state.activeAgentConversationId
          : importedAgentConversations[0]?.id ?? agentConversations[0]?.id ?? null
        return { agentConversations, activeAgentConversationId }
      })
      await replaceStoredAgentConversations(useStore.getState().agentConversations)
      skipSupportPromptForImportedData(tasks)
    }

    for (const project of importedPromptProjects) await putPromptProject(project)
    for (const doc of importedCanvasDocuments) await putCanvasDocument(doc)
    scheduleThumbnailBackfill(importedImageIds)

    if (options.importConfig && data.settings) {
      const state = useStore.getState()
      state.setSettings(mergeImportedSettings(state.settings, data.settings))
    }

    const imported = [
      ...(options.importTasks && data.tasks ? [`${data.tasks.length} 个任务`] : []),
      ...(options.importPromptProjects && data.promptProjects ? [`${importedPromptProjects.length} 个提示词项目`] : []),
      ...(importedCanvasDocuments.length ? [`${importedCanvasDocuments.length} 个画布`] : []),
    ]
    const msg = imported.length
      ? `已导入 ${imported.join('、')}`
      : options.importConfig && data.settings
      ? '配置已成功导入'
      : '数据已成功导入'

    useStore.getState().showToast(msg, 'success')
    return true
  } catch (err) {
    useStore.getState().showToast(`导入失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    return false
  }
}
