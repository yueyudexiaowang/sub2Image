import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import type { PromptProject } from './features/promptStudio'
import { DEFAULT_PARAMS } from './types'
import { createDefaultFalProfile, createDefaultOpenAIProfile, DEFAULT_RESPONSES_MODEL, DEFAULT_SETTINGS, normalizeSettings } from './lib/apiProfiles'
import { buildExportZip } from './lib/exportZip'
import type { AgentConversation, ExportData, StoredImage, StoredImageThumbnail, TaskRecord } from './types'
import { getSelectedImageMentionLabel } from './lib/promptImageMentions'
vi.mock('./lib/db', () => {
  const tasks = new Map<string, TaskRecord>()
  const images = new Map<string, StoredImage>()
  const thumbnails = new Map<string, StoredImageThumbnail>()
  const agentConversations = new Map<string, AgentConversation>()
  const promptProjects = new Map<string, PromptProject>()
  const canvasDocuments = new Map<string, { id: string }>()
  let imageSeq = 0

  return {
    CURRENT_THUMBNAIL_VERSION: 2,
    getAllCanvasDocuments: async () => [...canvasDocuments.values()],
    getCanvasDocument: async (id: string) => canvasDocuments.get(id) ?? null,
    putCanvasDocument: async (doc: { id: string }) => {
      canvasDocuments.set(doc.id, doc)
      return doc.id
    },
    deleteCanvasDocument: async (id: string) => {
      canvasDocuments.delete(id)
    },
    clearCanvasDocuments: async () => {
      canvasDocuments.clear()
    },
    getAllTasks: async () => [...tasks.values()],
    putTask: async (task: TaskRecord) => {
      tasks.set(task.id, task)
      return task.id
    },
    deleteTask: async (id: string) => {
      tasks.delete(id)
    },
    clearTasks: async () => {
      tasks.clear()
    },
    getAllAgentConversations: async () => [...agentConversations.values()],
    putAgentConversation: async (conversation: AgentConversation) => {
      agentConversations.set(conversation.id, conversation)
      return conversation.id
    },
    deleteAgentConversation: async (id: string) => {
      agentConversations.delete(id)
    },
    clearAgentConversations: async () => {
      agentConversations.clear()
    },
    replaceAgentConversations: async (conversations: AgentConversation[]) => {
      agentConversations.clear()
      for (const conversation of conversations) agentConversations.set(conversation.id, conversation)
    },
    getAllPromptProjects: async () => [...promptProjects.values()],
    getPromptProject: async (id: string) => promptProjects.get(id),
    getPromptProjectByConversationId: async (conversationId: string) =>
      [...promptProjects.values()]
        .filter((project) => project.conversationId === conversationId)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0],
    putPromptProject: async (project: PromptProject) => {
      promptProjects.set(project.id, project)
      return project.id
    },
    deletePromptProject: async (id: string) => {
      promptProjects.delete(id)
    },
    clearPromptProjects: async () => {
      promptProjects.clear()
    },
    getImage: async (id: string) => images.get(id),
    getImageThumbnail: async (id: string) => thumbnails.get(id),
    getStoredFreshImageThumbnail: async (id: string) => thumbnails.get(id),
    getAllImageIds: async () => [...images.keys()],
    getAllImages: async () => [...images.values()],
    putImage: async (image: StoredImage) => {
      images.set(image.id, image)
      return image.id
    },
    putImageThumbnail: async (thumbnail: StoredImageThumbnail) => {
      thumbnails.set(thumbnail.id, thumbnail)
      return thumbnail.id
    },
    deleteImage: async (id: string) => {
      images.delete(id)
      thumbnails.delete(id)
    },
    clearImages: async () => {
      images.clear()
      thumbnails.clear()
    },
    getAllVideos: async () => [],
    clearVideos: async () => {},
    putVideo: async (video: { id: string }) => video.id,
    getVideo: async () => undefined,
    deleteVideo: async () => {},
    storeImage: async (dataUrl: string, source: StoredImage['source'] = 'upload') => {
      const id = `stored-image-${++imageSeq}`
      images.set(id, { id, dataUrl, source, createdAt: Date.now() })
      return id
    },
    storeImageWithSize: async (dataUrl: string, source: StoredImage['source'] = 'upload') => {
      const id = `stored-image-${++imageSeq}`
      const size = dataUrl.match(/(\d+)x(\d+)/)
      const width = size ? Number(size[1]) : undefined
      const height = size ? Number(size[2]) : undefined
      images.set(id, { id, dataUrl, source, createdAt: Date.now(), width, height })
      return { id, width, height }
    },
  }
})
vi.mock('./integrations/imageApi', () => ({
  callImageApi: vi.fn(async () => ({
    images: [],
    actualParams: {},
    actualParamsList: [],
    revisedPrompts: [],
  })),
  getFalErrorMessage: vi.fn((err: unknown) => err instanceof Error ? err.message : String(err)),
  getFalQueuedImageResult: vi.fn(async () => ({
    images: [],
    actualParams: {},
    actualParamsList: [],
    revisedPrompts: [],
  })),
  getCustomQueuedImageResult: vi.fn(async () => ({
    images: [],
    actualParams: {},
    actualParamsList: [],
    revisedPrompts: [],
  })),
}))
vi.mock('./lib/transparentImage', () => ({
  GREEN_KEY_COLOR: '#00FF00',
  MAGENTA_KEY_COLOR: '#FF00FF',
  createTransparentOutputMeta: vi.fn((prompt: string) => ({
    transparentOutput: true,
    effectivePrompt: `transparent:${prompt}`,
  })),
  getTransparentRequestParams: vi.fn((params: typeof DEFAULT_PARAMS) => ({
    ...params,
    output_format: 'png',
    output_compression: null,
    transparent_output: true,
  })),
  removeKeyedBackgroundFromDataUrl: vi.fn(async (dataUrl: string) => `transparent:${dataUrl}`),
}))
vi.mock('./integrations/conversation/agentApi', () => ({
  callAgentConversationTitleApi: vi.fn(async () => '标题'),
  callAgentResponsesApi: vi.fn(() => new Promise(() => {})),
  callBatchImageSingle: vi.fn(async (opts: { batchItemId: string; prompt: string }) => ({
    batchItemId: opts.batchItemId,
    image: { dataUrl: 'data:image/png;base64,batch-output', revisedPrompt: opts.prompt },
    error: null,
  })),
  parseBatchImageCallArguments: vi.fn((args: string) => {
    try {
      const parsed = JSON.parse(args) as { images?: Array<{ id?: string; prompt?: string }> }
      return parsed.images?.map((item, index) => ({
        id: item.id || `image_${index + 1}`,
        prompt: item.prompt || '',
      })) ?? null
    } catch {
      return null
    }
  }),
}))
import { clearAgentConversations, clearImages, clearPromptProjects, clearTasks, getAllAgentConversations, getAllPromptProjects, getAllTasks, getImage, putAgentConversation, putImage, putPromptProject, putTask as putDbTask } from './lib/db'
import { callImageApi, getCustomQueuedImageResult, getFalQueuedImageResult } from './integrations/imageApi'
import { callAgentConversationTitleApi, callAgentResponsesApi, callBatchImageSingle } from './integrations/conversation/agentApi'
import { removeKeyedBackgroundFromDataUrl } from './lib/transparentImage'
import { applyComposerDraft, cleanStaleAgentInputDrafts, clearData, clearFailedTasks, deleteAgentRoundFromConversation, deleteFavoriteCollection, deleteImageIfUnreferenced, editOutputs, getActiveAgentRounds, getAgentConversationTaskIds, getAgentRoundTaskIds, getErrorToastMessage, getPersistedState, getTaskApiProfile, importData, initStore, loadComposerDraft, markInterruptedOpenAIRunningTasks, migratePersistedState, regenerateAgentAssistantMessage, remapAgentRoundMentionsForPathChange, removeMultipleTasks, removeTask, reuseConfig, stopAgentResponse, submitAgentMessage, submitTask, taskMatchesFilterStatus, taskMatchesSearchQuery, useStore } from './store'

const imageA = { id: 'image-a', dataUrl: 'data:image/png;base64,a' }
const imageB = { id: 'image-b', dataUrl: 'data:image/png;base64,b' }

describe('error toast messages', () => {
  it('drops long error detail after the failure title', () => {
    expect(getErrorToastMessage('Agent 请求失败：接口拒绝了很长的提示词内容')).toBe('Agent 请求失败')
  })

  it('uses a generic message for long raw errors without a title', () => {
    expect(getErrorToastMessage(`invalid request ${'x'.repeat(90)}`)).toBe('操作失败，请查看详情')
  })
})

describe('prompt project image references', () => {
  beforeEach(async () => {
    await clearTasks()
    await clearAgentConversations()
    await clearImages()
    await clearPromptProjects()
    useStore.setState({
      tasks: [],
      agentConversations: [],
      agentInputDrafts: {},
      galleryInputDraft: null,
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      showToast: vi.fn(),
    })
  })

  it('does not delete an image while a prompt project still references it', async () => {
    await putImage({ id: 'project-image', dataUrl: 'data:image/png;base64,project' })
    await putPromptProject(promptProject({
      source: {
        type: 'conversation',
        assets: [{ id: 'project-image', type: 'image', label: '主体参考' }],
      },
    }))

    await deleteImageIfUnreferenced('project-image')
    expect(await getImage('project-image')).toBeDefined()

    await clearPromptProjects()
    await deleteImageIfUnreferenced('project-image')
    expect(await getImage('project-image')).toBeUndefined()
  })

  it('loads prompt project references before startup orphan cleanup', async () => {
    await putImage({ id: 'project-image', dataUrl: 'data:image/png;base64,project' })
    await putImage({ id: 'orphan-image', dataUrl: 'data:image/png;base64,orphan' })
    await putPromptProject(promptProject({
      source: {
        type: 'conversation',
        assets: [{ id: 'project-image', type: 'image', label: '主体参考' }],
      },
    }))

    await initStore()

    expect(await getImage('project-image')).toBeDefined()
    expect(await getImage('orphan-image')).toBeUndefined()
  })

  it('keeps project images when clearing tasks without prompt projects', async () => {
    await putImage({ id: 'project-image', dataUrl: 'data:image/png;base64,project' })
    await putPromptProject(promptProject({
      source: {
        type: 'conversation',
        assets: [{ id: 'project-image', type: 'image', label: '主体参考' }],
      },
    }))

    await clearData({ clearConfig: false, clearTasks: true, clearPromptProjects: false })

    expect(await getImage('project-image')).toBeDefined()
    expect(await getAllPromptProjects()).toHaveLength(1)

    await clearData({ clearConfig: false, clearTasks: false, clearPromptProjects: true })
    expect(await getImage('project-image')).toBeUndefined()
  })

  it('keeps project images across single, batch and failed task cleanup', async () => {
    await putImage({ id: 'project-image', dataUrl: 'data:image/png;base64,project' })
    await putPromptProject(promptProject({
      source: {
        type: 'conversation',
        assets: [{ id: 'project-image', type: 'image', label: '主体参考' }],
      },
    }))

    const single = task({ id: 'single-task', outputImages: ['project-image'] })
    useStore.setState({ tasks: [single] })
    await removeTask(single)
    expect(await getImage('project-image')).toBeDefined()

    const batchA = task({ id: 'batch-a', outputImages: ['project-image'] })
    const batchB = task({ id: 'batch-b', inputImageIds: ['project-image'] })
    useStore.setState({ tasks: [batchA, batchB] })
    await removeMultipleTasks([batchA.id, batchB.id])
    expect(await getImage('project-image')).toBeDefined()

    const failed = task({ id: 'failed-task', status: 'error', error: '失败', outputImages: ['project-image'] })
    useStore.setState({ tasks: [failed] })
    await clearFailedTasks()
    expect(await getImage('project-image')).toBeDefined()
  })
})

function agentConversation(overrides: Partial<AgentConversation> = {}): AgentConversation {
  return {
    id: 'conversation-a',
    title: '新对话',
    activeRoundId: null,
    createdAt: 1,
    updatedAt: 1,
    rounds: [],
    messages: [],
    ...overrides,
  }
}

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}

function promptProject(overrides: Partial<PromptProject> = {}): PromptProject {
  return {
    id: 'project-a',
    conversationId: 'conversation-a',
    domain: 'image',
    title: '提示词项目',
    source: { type: 'conversation' },
    brief: { domain: 'image', fields: {} },
    messages: [],
    pendingConflicts: [],
    versions: [],
    phase: 'ready',
    schemaVersion: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function importFile(data: ExportData): File {
  const zipped = zipSync({ 'manifest.json': strToU8(JSON.stringify(data)) })
  const buffer = zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength)
  return { arrayBuffer: async () => buffer } as File
}

function importZip(bytes: Uint8Array): File {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return { arrayBuffer: async () => buffer } as File
}

describe('composer draft commands', () => {
  beforeEach(() => {
    useStore.setState({
      appMode: 'agent',
      prompt: '旧草稿',
      inputImages: [imageA],
      maskDraft: null,
      maskEditorImageId: null,
      params: { ...DEFAULT_PARAMS },
      agentConversations: [agentConversation()],
      activeAgentConversationId: 'conversation-a',
      agentInputDrafts: {},
    })
  })

  it('applies text, images, mask, mentions and params in one store update', () => {
    const prompt = `${getSelectedImageMentionLabel(0)} 和 ${getSelectedImageMentionLabel(1)}`
    let updates = 0
    const unsubscribe = useStore.subscribe(() => { updates += 1 })

    applyComposerDraft({
      prompt,
      inputImages: [imageA, imageB],
      maskDraft: {
        targetImageId: imageB.id,
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
      maskEditorImageId: imageB.id,
      params: { quality: 'high' },
    })
    unsubscribe()

    const state = useStore.getState()
    expect(updates).toBe(1)
    expect(state.inputImages.map((img) => img.id)).toEqual([imageB.id, imageA.id])
    expect(state.prompt).toBe(`${getSelectedImageMentionLabel(1)} 和 ${getSelectedImageMentionLabel(0)}`)
    expect(state.maskDraft).toMatchObject({ targetImageId: imageB.id })
    expect(state.maskEditorImageId).toBe(imageB.id)
    expect(state.params.quality).toBe('high')
    expect(state.agentInputDrafts['conversation-a']).toMatchObject({
      prompt: state.prompt,
      inputImages: state.inputImages,
      maskDraft: state.maskDraft,
      maskEditorImageId: imageB.id,
    })
    expect(state.agentInputDrafts['conversation-a']).not.toHaveProperty('params')
  })

  it('loads a detached snapshot and clears a mask whose target is missing', () => {
    useStore.setState({ params: { ...DEFAULT_PARAMS, quality: 'medium' } })
    applyComposerDraft({
      prompt: getSelectedImageMentionLabel(0),
      inputImages: [imageA],
      maskDraft: {
        targetImageId: 'missing-image',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
      maskEditorImageId: 'missing-image',
    })

    const draft = loadComposerDraft()
    draft.inputImages[0]!.dataUrl = 'changed'
    draft.params!.quality = 'low'

    const state = useStore.getState()
    expect(state.maskDraft).toBeNull()
    expect(state.maskEditorImageId).toBeNull()
    expect(state.inputImages[0]?.dataUrl).toBe(imageA.dataUrl)
    expect(state.params.quality).toBe('medium')
  })
})

describe('favorite collection deletion', () => {
  const collectionA = { id: 'collection-a', name: '素材集 A', createdAt: 1, updatedAt: 1 }
  const collectionB = { id: 'collection-b', name: '素材集 B', createdAt: 1, updatedAt: 1 }

  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    useStore.setState({
      tasks: [],
      favoriteCollections: [collectionA, collectionB],
      defaultFavoriteCollectionId: collectionA.id,
      activeFavoriteCollectionId: collectionA.id,
      selectedFavoriteCollectionIds: [collectionA.id],
      selectedTaskIds: [],
      inputImages: [],
      galleryInputDraft: null,
      agentConversations: [],
      showToast: vi.fn(),
    })
  })

  it('keeps tasks that are still referenced by another collection when deleting collection tasks', async () => {
    const sharedTask = task({
      id: 'shared-task',
      isFavorite: true,
      favoriteCollectionIds: [collectionA.id, collectionB.id],
    })
    const collectionOnlyTask = task({
      id: 'collection-only-task',
      isFavorite: true,
      favoriteCollectionIds: [collectionA.id],
    })
    useStore.setState({ tasks: [sharedTask, collectionOnlyTask] })
    await putDbTask(sharedTask)
    await putDbTask(collectionOnlyTask)

    await deleteFavoriteCollection(collectionA.id, true)

    const state = useStore.getState()
    expect(state.favoriteCollections.map((collection) => collection.id)).toEqual([collectionB.id])
    expect(state.activeFavoriteCollectionId).toBeNull()
    expect(state.selectedFavoriteCollectionIds).toEqual([])
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0]).toMatchObject({
      id: sharedTask.id,
      isFavorite: true,
      favoriteCollectionIds: [collectionB.id],
    })
    expect((await getAllTasks()).map((item) => item.id)).toEqual([sharedTask.id])
  })
})

describe('mask draft lifecycle in store actions', () => {
  beforeEach(() => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      detailTaskId: null,
      lightboxImageId: null,
      lightboxImageList: [],
      showSettings: false,
      toast: null,
      confirmDialog: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('preserves an existing mask when quick edit-output adds outputs as references', async () => {
    const maskDraft = {
      targetImageId: imageA.id,
      maskDataUrl: 'data:image/png;base64,mask',
      updatedAt: 1,
    }
    useStore.setState({
      inputImages: [imageA],
      maskDraft,
    })

    await editOutputs(task({ outputImages: [imageA.id] }))

    expect(useStore.getState().maskDraft).toEqual(maskDraft)
  })

  it('clears an invalid mask draft when submit cannot find the mask target image', async () => {
    useStore.setState({
      inputImages: [imageA],
      maskDraft: {
        targetImageId: 'missing-image',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
    })

    await submitTask()

    expect(useStore.getState().maskDraft).toBeNull()
  })

  it('shows a submitted toast after creating a gallery task', async () => {
    await submitTask()

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(1)
    expect(state.showToast).toHaveBeenCalledWith('任务已提交', 'success')
  })

  it('submits with an explicitly selected image profile', async () => {
    const activeProfile = createDefaultOpenAIProfile({ id: 'active-profile', apiKey: 'active-key', model: 'text-model' })
    const imageProfile = createDefaultOpenAIProfile({ id: 'image-profile', apiKey: 'image-key', model: 'image-model' })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [activeProfile, imageProfile],
        activeProfileId: activeProfile.id,
      }),
    })

    await submitTask({ apiProfileId: imageProfile.id })

    expect(useStore.getState().tasks[0]).toMatchObject({
      apiProfileId: imageProfile.id,
      apiModel: imageProfile.model,
    })
  })

  it('submits the captured gallery draft without clearing newer input', async () => {
    const state = useStore.getState()
    const draft = {
      prompt: '点击发送时的提示词',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
    }
    useStore.setState({
      settings: { ...state.settings, clearInputAfterSubmit: true },
      prompt: '发送后继续输入的内容',
    })

    await submitTask({ draft })

    expect(useStore.getState().tasks[0].prompt).toBe(draft.prompt)
    expect(useStore.getState().prompt).toBe('发送后继续输入的内容')
  })

  it('stores decoded image size as actual size when the API omits size', async () => {
    const { callImageApi } = await import('./integrations/imageApi')
    vi.mocked(callImageApi).mockClear()
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: ['data:image/png;base64,actual-1254x1254'],
      actualParams: { output_format: 'png' },
      actualParamsList: [{ output_format: 'png' }],
      revisedPrompts: [],
    })
    useStore.setState({
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, size: '2048x2048' },
    })

    await submitTask()
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))

    const [task] = useStore.getState().tasks
    expect(task.actualParams).toMatchObject({ size: '1254x1254', output_format: 'png', n: 1 })
    expect(task.actualParamsByImage?.[task.outputImages[0]]).toMatchObject({ size: '1254x1254', output_format: 'png' })
    await clearTasks()
    await clearImages()
  })

  it('keeps API-returned actual size over decoded image size', async () => {
    const { callImageApi } = await import('./integrations/imageApi')
    vi.mocked(callImageApi).mockClear()
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: ['data:image/png;base64,actual-1254x1254'],
      actualParams: { output_format: 'png', size: '1024x1024' },
      actualParamsList: [{ output_format: 'png', size: '1024x1024' }],
      revisedPrompts: [],
    })
    useStore.setState({
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, size: '2048x2048' },
    })

    await submitTask()
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))

    const [task] = useStore.getState().tasks
    expect(task.actualParams?.size).toBe('1024x1024')
    expect(task.actualParamsByImage?.[task.outputImages[0]].size).toBe('1024x1024')
    await clearTasks()
    await clearImages()
  })

  it('stores transparent background output after local post-processing', async () => {
    const { callImageApi } = await import('./integrations/imageApi')
    vi.mocked(callImageApi).mockClear()
    vi.mocked(removeKeyedBackgroundFromDataUrl).mockClear()
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: ['data:image/png;base64,generated'],
      actualParams: { output_format: 'png' },
      actualParamsList: [{ output_format: 'png' }],
      revisedPrompts: [],
    })
    useStore.setState({
      prompt: '单主体贴纸素材',
      params: {
        ...DEFAULT_PARAMS,
        output_format: 'png',
        output_compression: null,
        transparent_output: true,
      },
    })

    await submitTask()
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(callImageApi).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'transparent:单主体贴纸素材',
      params: expect.objectContaining({
        output_format: 'png',
        output_compression: null,
        transparent_output: true,
      }),
    }))
    expect(removeKeyedBackgroundFromDataUrl).toHaveBeenCalledWith('data:image/png;base64,generated')
    const [task] = useStore.getState().tasks
    expect(task).toMatchObject({
      prompt: '单主体贴纸素材',
      transparentOutput: true,
      transparentPrompt: 'transparent:单主体贴纸素材',
      status: 'done',
    })
    expect(task.transparentOriginalImages).toHaveLength(1)
    const outputImage = await getImage(task.outputImages[0])
    const originalImage = await getImage(task.transparentOriginalImages![0])
    expect(outputImage?.dataUrl).toBe('transparent:data:image/png;base64,generated')
    expect(originalImage?.dataUrl).toBe('data:image/png;base64,generated')
    await clearTasks()
    await clearImages()
  })

  it('falls back to the original output when transparent post-processing fails', async () => {
    const { callImageApi } = await import('./integrations/imageApi')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(callImageApi).mockClear()
    vi.mocked(removeKeyedBackgroundFromDataUrl).mockClear()
    vi.mocked(removeKeyedBackgroundFromDataUrl).mockRejectedValueOnce(new Error('post-process failed'))
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: ['data:image/png;base64,generated'],
      actualParams: { output_format: 'png' },
      actualParamsList: [{ output_format: 'png' }],
      revisedPrompts: [],
    })
    useStore.setState({
      prompt: '单主体贴纸素材',
      params: {
        ...DEFAULT_PARAMS,
        output_format: 'png',
        output_compression: null,
        transparent_output: true,
      },
    })

    await submitTask()
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const [task] = useStore.getState().tasks
    expect(task).toMatchObject({
      transparentOutput: true,
      status: 'done',
    })
    expect(task.transparentOriginalImages).toEqual([''])
    const outputImage = await getImage(task.outputImages[0])
    expect(outputImage?.dataUrl).toBe('data:image/png;base64,generated')
    warnSpy.mockRestore()
    await clearTasks()
    await clearImages()
  })

  it('supports transparent background post-processing for fal gallery tasks', async () => {
    const { callImageApi } = await import('./integrations/imageApi')
    const falProfile = createDefaultFalProfile({ id: 'fal-profile', apiKey: 'fal-key' })
    vi.mocked(callImageApi).mockClear()
    vi.mocked(removeKeyedBackgroundFromDataUrl).mockClear()
    vi.mocked(callImageApi).mockResolvedValueOnce({
      images: ['data:image/png;base64,fal-generated'],
      actualParams: { output_format: 'png' },
      actualParamsList: [{ output_format: 'png' }],
      revisedPrompts: [],
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [falProfile],
        activeProfileId: falProfile.id,
      }),
      prompt: '单主体图标素材',
      params: {
        ...DEFAULT_PARAMS,
        output_format: 'png',
        transparent_output: true,
      },
    })

    await submitTask()
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(callImageApi).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({
        output_format: 'png',
        transparent_output: true,
      }),
    }))
    expect(removeKeyedBackgroundFromDataUrl).toHaveBeenCalledWith('data:image/png;base64,fal-generated')
    const [task] = useStore.getState().tasks
    expect(task.apiProvider).toBe('fal')
    expect(task.transparentOutput).toBe(true)
    expect(task.transparentOriginalImages).toHaveLength(1)
    await clearTasks()
    await clearImages()
  })

  it('preserves selected image mentions when replacing a mask target with an equivalent image id', () => {
    const replacement = { id: 'image-a-replacement', dataUrl: imageA.dataUrl }
    const prompt = `参考 ${getSelectedImageMentionLabel(0)} 生成`
    useStore.setState({
      prompt,
      inputImages: [imageA, imageB],
    })

    useStore.getState().setInputImages([replacement, imageB], {
      equivalentImageIds: { [imageA.id]: replacement.id },
    })

    const state = useStore.getState()
    expect(state.inputImages.map((img) => img.id)).toEqual([replacement.id, imageB.id])
    expect(state.prompt).toBe(prompt)
  })
})

describe('external request aborts in store actions', () => {
  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    vi.mocked(callImageApi).mockReset().mockResolvedValue({
      images: [],
      actualParams: {},
      actualParamsList: [],
      revisedPrompts: [],
    })
    vi.mocked(getFalQueuedImageResult).mockClear()
    vi.mocked(getCustomQueuedImageResult).mockClear()
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      appMode: 'gallery',
      prompt: 'prompt',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      streamPreviews: {},
      streamPreviewSlots: {},
      confirmDialog: null,
      reusedTaskApiProfileId: null,
      reusedTaskApiProfileName: null,
      reusedTaskApiProfileMissing: false,
      agentConversations: [],
      activeAgentConversationId: null,
      showToast: vi.fn(),
    })
  })

  it('passes the signal to the image API and ignores partials and results that arrive after abort', async () => {
    let apiOpts!: Parameters<typeof callImageApi>[0]
    let start!: () => void
    let resolveApi!: (result: Awaited<ReturnType<typeof callImageApi>>) => void
    const started = new Promise<void>((resolve) => { start = resolve })
    const apiResult = new Promise<Awaited<ReturnType<typeof callImageApi>>>((resolve) => { resolveApi = resolve })
    vi.mocked(callImageApi).mockImplementationOnce(async (opts) => {
      apiOpts = opts
      start()
      return apiResult
    })
    const controller = new AbortController()
    const submit = submitTask({ signal: controller.signal })

    await started
    const taskId = useStore.getState().tasks[0].id
    expect(apiOpts.signal).toBe(controller.signal)

    controller.abort(new DOMException('用户停止', 'AbortError'))
    apiOpts.onPartialImage?.({ image: 'data:image/png;base64,late-partial' })
    resolveApi({
      images: ['data:image/png;base64,late-result'],
      actualParams: {},
      actualParamsList: [],
      revisedPrompts: [],
    })
    await submit

    const stopped = useStore.getState().tasks.find((item) => item.id === taskId)
    expect(stopped).toMatchObject({
      status: 'error',
      error: '已停止生成。',
      outputImages: [],
      falRecoverable: false,
      customRecoverable: false,
    })
    expect(stopped?.streamPartialImageIds).toBeUndefined()
    expect(useStore.getState().streamPreviews[taskId]).toBeUndefined()
    expect(useStore.getState().streamPreviewSlots[taskId]).toBeUndefined()
  })

  it('keeps the same signal after confirming a missing reused profile', async () => {
    const profile = createDefaultOpenAIProfile({ id: 'current-profile', apiKey: 'test-key' })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [profile],
        activeProfileId: profile.id,
        reuseTaskApiProfileTemporarily: true,
      }),
      reusedTaskApiProfileId: null,
      reusedTaskApiProfileName: '已删除配置',
      reusedTaskApiProfileMissing: true,
    })
    let apiSignal: AbortSignal | undefined
    let start!: () => void
    const started = new Promise<void>((resolve) => { start = resolve })
    vi.mocked(callImageApi).mockImplementationOnce((opts) => new Promise((_resolve, reject) => {
      apiSignal = opts.signal
      start()
      opts.signal?.addEventListener('abort', () => reject(opts.signal?.reason), { once: true })
    }))
    const controller = new AbortController()
    const submit = submitTask({ signal: controller.signal })
    const dialog = useStore.getState().confirmDialog

    expect(dialog?.title).toBe('找不到 API 配置')
    dialog?.action?.()
    useStore.setState({ confirmDialog: null })
    await started
    controller.abort(new DOMException('用户停止', 'AbortError'))
    await submit

    expect(apiSignal).toBe(controller.signal)
    expect(useStore.getState().tasks[0]).toMatchObject({ status: 'error', error: '已停止生成。' })
  })

  it('closes a pending task confirmation when its Runtime signal aborts', async () => {
    useStore.setState({
      settings: normalizeSettings({ ...DEFAULT_SETTINGS, reuseTaskApiProfileTemporarily: true }),
      reusedTaskApiProfileId: null,
      reusedTaskApiProfileName: '已删除配置',
      reusedTaskApiProfileMissing: true,
    })
    const controller = new AbortController()
    const submit = submitTask({ signal: controller.signal })
    expect(useStore.getState().confirmDialog?.title).toBe('找不到 API 配置')

    controller.abort(new DOMException('用户停止', 'AbortError'))

    await expect(submit).rejects.toMatchObject({ name: 'AbortError' })
    expect(useStore.getState().confirmDialog).toBeNull()
    expect(useStore.getState().tasks).toEqual([])
  })

  it.each(['fal', 'custom'] as const)('does not schedule %s recovery after caller abort', async (provider) => {
    vi.useFakeTimers()
    try {
      const profile = provider === 'fal'
        ? createDefaultFalProfile({ id: 'fal-abort', apiKey: 'test-key' })
        : { ...createDefaultOpenAIProfile({ id: 'custom-abort', apiKey: 'test-key' }), provider: 'custom-abort' }
      useStore.setState({
        settings: normalizeSettings({
          ...DEFAULT_SETTINGS,
          customProviders: provider === 'custom' ? [{
            id: 'custom-abort',
            name: 'Custom Abort',
            submit: { path: 'images/generations', taskIdPath: 'task_id' },
            poll: {
              path: 'images/tasks/{task_id}',
              statusPath: 'status',
              successValues: ['done'],
              failureValues: ['failed'],
              result: { b64JsonPaths: ['data.*.b64_json'] },
            },
          }] : [],
          profiles: [profile],
          activeProfileId: profile.id,
        }),
      })

      let start!: () => void
      let resolveApi!: (result: Awaited<ReturnType<typeof callImageApi>>) => void
      const started = new Promise<void>((resolve) => { start = resolve })
      const apiResult = new Promise<Awaited<ReturnType<typeof callImageApi>>>((resolve) => { resolveApi = resolve })
      vi.mocked(callImageApi).mockImplementationOnce(async (opts) => {
        if (provider === 'fal') opts.onFalRequestEnqueued?.({ requestId: 'fal-request', endpoint: 'fal/model' })
        else opts.onCustomTaskEnqueued?.({ taskId: 'custom-task' })
        start()
        return apiResult
      })
      const controller = new AbortController()
      const submit = submitTask({ signal: controller.signal })

      await started
      controller.abort(new DOMException('用户停止', 'AbortError'))
      resolveApi({ images: [], actualParams: {}, actualParamsList: [], revisedPrompts: [] })
      await submit

      expect(useStore.getState().tasks[0]).toMatchObject({
        status: 'error',
        error: '已停止生成。',
        falRecoverable: false,
        customRecoverable: false,
      })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(getFalQueuedImageResult).not.toHaveBeenCalled()
      expect(getCustomQueuedImageResult).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops the Agent round when its external signal aborts', async () => {
    const profile = createDefaultOpenAIProfile({
      id: 'agent-abort',
      apiKey: 'test-key',
      apiMode: 'responses',
      model: DEFAULT_RESPONSES_MODEL,
    })
    const conversation = agentConversation()
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [profile],
        activeProfileId: profile.id,
      }),
      appMode: 'agent',
      prompt: '停止这个回复',
      agentConversations: [conversation],
      activeAgentConversationId: conversation.id,
    })

    let apiSignal: AbortSignal | undefined
    let titleSignal: AbortSignal | undefined
    let start!: () => void
    const started = new Promise<void>((resolve) => { start = resolve })
    vi.mocked(callAgentResponsesApi).mockImplementationOnce((opts) => new Promise((_resolve, reject) => {
      apiSignal = opts.signal
      start()
      opts.signal?.addEventListener('abort', () => reject(opts.signal?.reason), { once: true })
    }))
    vi.mocked(callAgentConversationTitleApi).mockImplementationOnce((opts) => new Promise((_resolve, reject) => {
      titleSignal = opts.signal
      opts.signal?.addEventListener('abort', () => reject(opts.signal?.reason), { once: true })
    }))
    const controller = new AbortController()
    const submit = submitAgentMessage({ signal: controller.signal })

    await started
    await vi.waitFor(() => expect(titleSignal).toBe(controller.signal))
    controller.abort(new DOMException('用户停止', 'AbortError'))
    await submit

    expect(apiSignal?.aborted).toBe(true)
    expect(titleSignal?.aborted).toBe(true)
    expect(useStore.getState().agentConversations[0].rounds[0]).toMatchObject({
      status: 'error',
      error: '已停止生成。',
    })
  })

  it('submits an Agent draft to its captured conversation after switching away', async () => {
    const profile = createDefaultOpenAIProfile({
      id: 'agent-snapshot',
      apiKey: 'test-key',
      apiMode: 'responses',
      model: DEFAULT_RESPONSES_MODEL,
    })
    const target = agentConversation({ id: 'conversation-target' })
    const active = agentConversation({ id: 'conversation-active' })
    const draft = {
      prompt: '目标会话的消息',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
    }
    vi.mocked(callAgentResponsesApi).mockResolvedValueOnce({
      responseId: 'response-snapshot',
      text: '完成',
      images: [],
      outputItems: [],
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [profile],
        activeProfileId: profile.id,
      }),
      appMode: 'agent',
      prompt: '当前会话的新草稿',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      agentConversations: [target, active],
      activeAgentConversationId: active.id,
      showToast: vi.fn(),
    })

    await submitAgentMessage({ conversationId: target.id, draft, editingRoundId: null })

    const state = useStore.getState()
    expect(state.agentConversations.find((item) => item.id === target.id)?.rounds[0]).toMatchObject({
      prompt: draft.prompt,
      status: 'done',
    })
    expect(state.agentConversations.find((item) => item.id === active.id)?.rounds).toEqual([])
    expect(state.prompt).toBe('当前会话的新草稿')
  })
})

describe('interrupted OpenAI running tasks', () => {
  it('marks legacy and OpenAI running tasks as interrupted', () => {
    const now = 10_000
    const legacyRunning = task({ id: 'legacy-running', status: 'running', createdAt: 1_000, finishedAt: null, elapsed: null })
    const openAIRunning = task({ id: 'openai-running', apiProvider: 'openai', status: 'running', createdAt: 2_000, finishedAt: null, elapsed: null })
    const falRunning = task({ id: 'fal-running', apiProvider: 'fal', status: 'running', createdAt: 3_000, finishedAt: null, elapsed: null })
    const customAsyncRunning = task({ id: 'custom-running', apiProvider: 'custom-provider', customTaskId: 'task-1', status: 'running', createdAt: 4_000, finishedAt: null, elapsed: null })
    const doneTask = task({ id: 'done-task', apiProvider: 'openai', status: 'done' })

    const result = markInterruptedOpenAIRunningTasks([legacyRunning, openAIRunning, falRunning, customAsyncRunning, doneTask], now)

    expect(result.interruptedTasks.map((item) => item.id)).toEqual(['legacy-running', 'openai-running'])
    expect(result.tasks.find((item) => item.id === 'legacy-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求中断'),
      finishedAt: now,
      elapsed: 9_000,
    })
    expect(result.tasks.find((item) => item.id === 'openai-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('请求中断'),
      finishedAt: now,
      elapsed: 8_000,
    })
    expect(result.tasks.find((item) => item.id === 'fal-running')).toEqual(falRunning)
    expect(result.tasks.find((item) => item.id === 'custom-running')).toEqual(customAsyncRunning)
    expect(result.tasks.find((item) => item.id === 'done-task')).toEqual(doneTask)
  })
})

describe('input persistence setting', () => {
  beforeEach(() => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS },
      appMode: 'gallery',
      prompt: 'prompt',
      inputImages: [imageA],
      galleryInputDraft: null,
      dismissedCodexCliPrompts: [],
    })
  })

  it('persists input when restart input restore is enabled', () => {
    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe('prompt')
    expect(persisted.inputImages).toEqual([{ id: imageA.id, dataUrl: '' }])
  })

  it('omits input when restart input restore is disabled', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, persistInputOnRestart: false } })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted).not.toHaveProperty('prompt')
    expect(persisted).not.toHaveProperty('inputImages')
  })

  it('writes empty input when persisted input is cleared', () => {
    useStore.setState({ prompt: '', inputImages: [] })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe('')
    expect(persisted.inputImages).toEqual([])
  })
})

describe('settings persistence', () => {
  it('persists the global theme preference', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } })
    useStore.getState().setSettings({ theme: 'dark' })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted.settings.theme).toBe('dark')
  })
})

describe('agent conversation persistence', () => {
  beforeEach(async () => {
    await clearAgentConversations()
  })

  it('omits agent conversations from localStorage state', () => {
    const conversation = agentConversation({
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        prompt: '画一张图',
        inputImageIds: [],
        outputTaskIds: ['task-a'],
        responseOutput: [
          { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
          { type: 'image_generation_call', id: 'image-call-a', result: 'large-base64-a' },
          { type: 'image_generation_call', id: 'image-call-b', result: { b64_json: 'large-base64-b', base64: 'large-base64-c', image: 'large-base64-d', data: 'large-base64-e' } },
        ],
        status: 'done',
        error: null,
        createdAt: 1,
        finishedAt: 2,
      }],
      messages: [
        { id: 'user-a', role: 'user', content: '画一张图', roundId: 'round-a', createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '已生成图片。', roundId: 'round-a', outputTaskIds: ['task-a'], createdAt: 2 },
      ],
    })
    useStore.setState({ agentConversations: [conversation] })

    const persisted = getPersistedState(useStore.getState())
    const serializedPersisted = JSON.stringify(persisted)

    expect('agentConversations' in persisted).toBe(false)
    expect(serializedPersisted).not.toContain('image_generation_call')
    expect(serializedPersisted).not.toContain('large-base64')
    expect(JSON.stringify(useStore.getState().agentConversations)).toContain('large-base64-a')
  })

  it('loads agent conversations from IndexedDB and migrates legacy localStorage conversations', async () => {
    const storedConversation = agentConversation({ id: 'stored-conversation', createdAt: 1, updatedAt: 1 })
    const legacyConversation = agentConversation({ id: 'legacy-conversation', createdAt: 2, updatedAt: 2 })
    useStore.setState({ agentConversations: [legacyConversation], activeAgentConversationId: legacyConversation.id })
    await new Promise((resolve) => setTimeout(resolve, 0))
    await putAgentConversation(storedConversation)

    await initStore()

    const state = useStore.getState()
    const stored = await getAllAgentConversations()
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['stored-conversation', 'legacy-conversation'])
    expect(state.activeAgentConversationId).toBe('legacy-conversation')
    expect(stored.map((conversation) => conversation.id)).toEqual(['stored-conversation', 'legacy-conversation'])
  })

  it('strips generated image payloads from legacy task raw payloads during startup migration', async () => {
    await putDbTask(task({
      id: 'legacy-task',
      outputImages: ['image-live'],
      rawResponsePayload: JSON.stringify({
        output: [{ type: 'image_generation_call', id: 'image-call-a', result: 'legacy-task-base64' }],
      }),
    }))

    await initStore()

    const storedTasks = await getAllTasks()
    const serializedStoredTasks = JSON.stringify(storedTasks)
    expect(serializedStoredTasks).toContain('image_generation_call')
    expect(serializedStoredTasks).not.toContain('legacy-task-base64')
  })

  it('keeps agent conversations created while initStore is loading', async () => {
    const legacyConversation = agentConversation({ id: 'legacy-conversation', createdAt: 1, updatedAt: 1 })
    const earlyConversation = agentConversation({ id: 'early-conversation', createdAt: 2, updatedAt: 2 })
    useStore.setState({ agentConversations: [legacyConversation], activeAgentConversationId: legacyConversation.id })

    const initPromise = initStore()
    useStore.setState({ agentConversations: [legacyConversation, earlyConversation], activeAgentConversationId: earlyConversation.id })
    await initPromise

    const state = useStore.getState()
    const stored = await getAllAgentConversations()
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['legacy-conversation', 'early-conversation'])
    expect(state.activeAgentConversationId).toBe('early-conversation')
    expect(stored.map((conversation) => conversation.id)).toEqual(['legacy-conversation', 'early-conversation'])
  })

  it('restores active conversation and draft when localStorage no longer stores conversations', async () => {
    const storedConversation = agentConversation({ id: 'stored-conversation', createdAt: 1, updatedAt: 1 })
    useStore.setState({
      appMode: 'agent',
      agentConversations: [],
      activeAgentConversationId: storedConversation.id,
      agentInputDrafts: {
        [storedConversation.id]: {
          prompt: '未发送草稿',
          inputImages: [],
          maskDraft: null,
          maskEditorImageId: null,
          updatedAt: Date.now(),
        },
      },
      prompt: '',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
    })
    await putAgentConversation(storedConversation)

    await initStore()

    const state = useStore.getState()
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['stored-conversation'])
    expect(state.activeAgentConversationId).toBe('stored-conversation')
    expect(state.agentInputDrafts['stored-conversation']?.prompt).toBe('未发送草稿')
    expect(state.prompt).toBe('未发送草稿')
  })

  it('strips generated image payloads when migrating old persisted state', () => {
    const migrated = migratePersistedState({
      settings: { ...DEFAULT_SETTINGS },
      agentConversations: [agentConversation({
        rounds: [{
          id: 'round-a',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-a',
          prompt: '画一张图',
          inputImageIds: [],
          outputTaskIds: ['task-a'],
          responseOutput: [
            { type: 'image_generation_call', id: 'image-call-a', result: 'legacy-base64-a' },
            { type: 'image_generation_call', id: 'image-call-b', result: { b64_json: 'legacy-base64-b', base64: 'legacy-base64-c' } },
          ],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        }],
      })],
    })

    const serializedMigrated = JSON.stringify(migrated)
    expect(serializedMigrated).not.toContain('legacy-base64')
    expect(serializedMigrated).toContain('image_generation_call')
  })
})

describe('fal task recovery', () => {
  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    await clearAgentConversations()
    vi.mocked(getFalQueuedImageResult).mockClear()
    vi.mocked(callAgentResponsesApi).mockClear()
    vi.mocked(removeKeyedBackgroundFromDataUrl).mockClear()
    const falProfile = createDefaultFalProfile({ id: 'fal-profile', apiKey: 'fal-key' })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [falProfile],
        activeProfileId: falProfile.id,
      }),
      tasks: [],
      inputImages: [],
      galleryInputDraft: null,
      agentConversations: [],
      showToast: vi.fn(),
    })
  })

  it('applies transparent post-processing when a fal task recovers', async () => {
    const falTask = task({
      id: 'fal-transparent-task',
      apiProvider: 'fal',
      apiProfileId: 'fal-profile',
      apiProfileName: 'fal',
      apiModel: 'fal-model',
      params: {
        ...DEFAULT_PARAMS,
        output_format: 'png',
        transparent_output: true,
      },
      transparentOutput: true,
      transparentPrompt: 'transparent:prompt',
      status: 'error',
      error: '连接已断开，等待自动恢复',
      falRequestId: 'fal-request-id',
      falEndpoint: 'fal-endpoint',
      falRecoverable: true,
      finishedAt: null,
      elapsed: null,
    })
    await putDbTask(falTask)
    vi.mocked(getFalQueuedImageResult).mockResolvedValueOnce({
      images: ['data:image/png;base64,fal-recovered'],
      actualParams: { output_format: 'png' },
      actualParamsList: [{ output_format: 'png' }],
      revisedPrompts: [],
    })

    await initStore()
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(removeKeyedBackgroundFromDataUrl).toHaveBeenCalledWith('data:image/png;base64,fal-recovered')
    const recovered = useStore.getState().tasks.find((item) => item.id === falTask.id)
    expect(recovered).toMatchObject({
      status: 'done',
      falRecoverable: false,
      transparentOutput: true,
    })
    expect(recovered?.transparentOriginalImages).toHaveLength(1)
    const outputImage = await getImage(recovered!.outputImages[0])
    const originalImage = await getImage(recovered!.transparentOriginalImages![0])
    expect(outputImage?.dataUrl).toBe('transparent:data:image/png;base64,fal-recovered')
    expect(originalImage?.dataUrl).toBe('data:image/png;base64,fal-recovered')
  })

  it('continues an Agent round after all fal image tasks recover', async () => {
    const textProfile = createDefaultOpenAIProfile({ id: 'agent-text-profile', apiKey: 'text-key', apiMode: 'responses' })
    const imageProfile = createDefaultFalProfile({ id: 'fal-profile', apiKey: 'fal-key' })
    const agentTask = task({
      id: 'agent-fal-task',
      prompt: '画一只猫',
      apiProvider: 'fal',
      apiProfileId: imageProfile.id,
      apiProfileName: imageProfile.name,
      apiModel: imageProfile.model,
      status: 'error',
      error: '与 fal.ai 的连接已断开，之后会继续查询任务结果。',
      falRequestId: 'fal-request-id',
      falEndpoint: 'fal-endpoint',
      falRecoverable: true,
      sourceMode: 'agent',
      agentConversationId: 'conversation-a',
      agentRoundId: 'round-a',
      agentMessageId: 'assistant-a',
      agentToolCallId: 'tool-a',
      finishedAt: Date.now(),
      elapsed: 10,
    })
    const conversation = agentConversation({
      id: 'conversation-a',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        prompt: '画一只猫',
        inputImageIds: [],
        outputTaskIds: [agentTask.id],
        responseOutput: [{ type: 'function_call', name: 'generate_image', call_id: 'tool-a', arguments: JSON.stringify({ id: 'cat', prompt: '画一只猫' }) }],
        status: 'running',
        error: null,
        createdAt: 1,
        finishedAt: null,
      }],
      messages: [
        { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '', roundId: 'round-a', outputTaskIds: [agentTask.id], createdAt: 2 },
      ],
    })
    vi.mocked(getFalQueuedImageResult).mockResolvedValue({
      images: ['data:image/png;base64,agent-recovered'],
      actualParams: {},
      actualParamsList: [{}],
      revisedPrompts: [],
    })
    vi.mocked(callAgentResponsesApi).mockResolvedValueOnce({
      text: '已完成。',
      images: [],
      outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '已完成。' }] }],
      responseId: 'response-done',
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [textProfile, imageProfile],
        activeProfileId: textProfile.id,
        agentApiConfigMode: 'hybrid',
        agentTextProfileId: textProfile.id,
        agentImageProfileId: imageProfile.id,
      }),
      tasks: [],
      agentConversations: [],
      activeAgentConversationId: conversation.id,
      showToast: vi.fn(),
    })
    await putDbTask(agentTask)
    await putAgentConversation(conversation)

    await initStore()
    for (let i = 0; i < 20 && useStore.getState().agentConversations[0]?.rounds[0]?.status !== 'done'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const recoveredTask = useStore.getState().tasks.find((item) => item.id === agentTask.id)
    expect(recoveredTask).toMatchObject({ status: 'done', falRecoverable: false })
    expect(callAgentResponsesApi).toHaveBeenCalledTimes(1)
    const agentInputJson = JSON.stringify(vi.mocked(callAgentResponsesApi).mock.calls[0][0].input)
    expect(agentInputJson).toContain('function_call_output')
    expect(agentInputJson).toContain('\\"status\\":\\"done\\"')
    const round = useStore.getState().agentConversations[0].rounds[0]
    expect(round).toMatchObject({ status: 'done', error: null, responseId: 'response-done' })
    expect(round.responseOutput).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function_call_output', call_id: 'tool-a' }),
    ]))
  })

  it('records recovered Agent tool failures without continuing the Agent round', async () => {
    const textProfile = createDefaultOpenAIProfile({ id: 'agent-text-profile', apiKey: 'text-key', apiMode: 'responses' })
    const imageProfile = createDefaultFalProfile({ id: 'fal-profile', apiKey: 'fal-key' })
    const agentTask = task({
      id: 'agent-fal-task',
      prompt: '画一只猫',
      apiProvider: 'fal',
      apiProfileId: imageProfile.id,
      apiProfileName: imageProfile.name,
      apiModel: imageProfile.model,
      status: 'error',
      error: '与 fal.ai 的连接已断开，之后会继续查询任务结果。',
      falRequestId: 'fal-request-id',
      falEndpoint: 'fal-endpoint',
      falRecoverable: true,
      sourceMode: 'agent',
      agentConversationId: 'conversation-a',
      agentRoundId: 'round-a',
      agentMessageId: 'assistant-a',
      agentToolCallId: 'tool-a',
      finishedAt: Date.now(),
      elapsed: 10,
    })
    const conversation = agentConversation({
      id: 'conversation-a',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        prompt: '画一只猫',
        inputImageIds: [],
        outputTaskIds: [agentTask.id],
        responseOutput: [{ type: 'function_call', name: 'generate_image', call_id: 'tool-a', arguments: JSON.stringify({ id: 'cat', prompt: '画一只猫' }) }],
        status: 'running',
        error: null,
        createdAt: 1,
        finishedAt: null,
      }],
      messages: [
        { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '', roundId: 'round-a', outputTaskIds: [agentTask.id], createdAt: 2 },
      ],
    })
    vi.mocked(getFalQueuedImageResult).mockRejectedValueOnce(new Error('quota exceeded'))
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [textProfile, imageProfile],
        activeProfileId: textProfile.id,
        agentApiConfigMode: 'hybrid',
        agentTextProfileId: textProfile.id,
        agentImageProfileId: imageProfile.id,
      }),
      tasks: [],
      agentConversations: [],
      activeAgentConversationId: 'conversation-a',
      showToast: vi.fn(),
    })
    await putDbTask(agentTask)
    await putAgentConversation(conversation)

    await initStore()
    for (let i = 0; i < 20 && useStore.getState().tasks.find((item) => item.id === agentTask.id)?.falRecoverable !== false; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(callAgentResponsesApi).not.toHaveBeenCalled()
    const failedTask = useStore.getState().tasks.find((item) => item.id === agentTask.id)
    expect(failedTask).toMatchObject({ status: 'error', error: 'quota exceeded', falRecoverable: false })
    const round = useStore.getState().agentConversations[0].rounds[0]
    expect(round).toMatchObject({ status: 'error', error: 'quota exceeded' })
    const toolOutput = round.responseOutput?.find((item) => item.type === 'function_call_output')
    expect(toolOutput).toMatchObject({ call_id: 'tool-a' })
    expect(toolOutput?.output).toContain('"status":"error"')
    expect(toolOutput?.output).toContain('quota exceeded')
  })

  it('does not call Agent again when recovered tasks already reached the tool limit', async () => {
    const textProfile = createDefaultOpenAIProfile({ id: 'agent-text-profile', apiKey: 'text-key', apiMode: 'responses' })
    const imageProfile = createDefaultFalProfile({ id: 'fal-profile', apiKey: 'fal-key' })
    const agentTask = task({
      id: 'agent-fal-task',
      prompt: '画一只猫',
      apiProvider: 'fal',
      apiProfileId: imageProfile.id,
      apiProfileName: imageProfile.name,
      apiModel: imageProfile.model,
      status: 'error',
      error: '与 fal.ai 的连接已断开，之后会继续查询任务结果。',
      falRequestId: 'limit-request-id',
      falEndpoint: 'fal-endpoint',
      falRecoverable: true,
      sourceMode: 'agent',
      agentConversationId: 'conversation-a',
      agentRoundId: 'round-a',
      agentMessageId: 'assistant-a',
      agentToolCallId: 'tool-a',
      finishedAt: Date.now(),
      elapsed: 10,
    })
    const conversation = agentConversation({
      id: 'conversation-a',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        prompt: '画一只猫',
        inputImageIds: [],
        outputTaskIds: [agentTask.id],
        responseOutput: [{ type: 'function_call', name: 'generate_image', call_id: 'tool-a', arguments: JSON.stringify({ id: 'cat', prompt: '画一只猫' }) }],
        status: 'running',
        error: null,
        createdAt: 1,
        finishedAt: null,
      }],
      messages: [
        { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '', roundId: 'round-a', outputTaskIds: [agentTask.id], createdAt: 2 },
      ],
    })
    vi.mocked(getFalQueuedImageResult).mockResolvedValueOnce({
      images: ['data:image/png;base64,agent-recovered-limit'],
      actualParams: {},
      actualParamsList: [{}],
      revisedPrompts: [],
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [textProfile, imageProfile],
        activeProfileId: textProfile.id,
        agentApiConfigMode: 'hybrid',
        agentTextProfileId: textProfile.id,
        agentImageProfileId: imageProfile.id,
        agentMaxToolRounds: 1,
      }),
      tasks: [],
      agentConversations: [],
      activeAgentConversationId: conversation.id,
      showToast: vi.fn(),
    })
    await putDbTask(agentTask)
    await putAgentConversation(conversation)

    await initStore()
    for (let i = 0; i < 20 && useStore.getState().agentConversations[0]?.rounds[0]?.status !== 'done'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(callAgentResponsesApi).not.toHaveBeenCalled()
    const round = useStore.getState().agentConversations[0].rounds[0]
    expect(round).toMatchObject({ status: 'done', error: null })
    expect(useStore.getState().agentConversations[0].messages.find((message) => message.id === 'assistant-a')?.content).toContain('已达到最大工具调用次数（1）')
  })

  it('does not continue a stopped Agent round when a recoverable fal task later completes', async () => {
    const textProfile = createDefaultOpenAIProfile({ id: 'agent-text-profile', apiKey: 'text-key', apiMode: 'responses' })
    const imageProfile = createDefaultFalProfile({ id: 'fal-profile', apiKey: 'fal-key' })
    const agentTask = task({
      id: 'agent-fal-task',
      prompt: '画一只猫',
      apiProvider: 'fal',
      apiProfileId: imageProfile.id,
      apiProfileName: imageProfile.name,
      apiModel: imageProfile.model,
      status: 'error',
      error: '与 fal.ai 的连接已断开，之后会继续查询任务结果。',
      falRequestId: 'fal-request-id',
      falEndpoint: 'fal-endpoint',
      falRecoverable: true,
      sourceMode: 'agent',
      agentConversationId: 'conversation-a',
      agentRoundId: 'round-a',
      agentMessageId: 'assistant-a',
      agentToolCallId: 'tool-a',
      finishedAt: Date.now(),
      elapsed: 10,
    })
    const conversation = agentConversation({
      id: 'conversation-a',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        prompt: '画一只猫',
        inputImageIds: [],
        outputTaskIds: [agentTask.id],
        responseOutput: [{ type: 'function_call', name: 'generate_image', call_id: 'tool-a', arguments: JSON.stringify({ id: 'cat', prompt: '画一只猫' }) }],
        status: 'error',
        error: '已停止生成。',
        createdAt: 1,
        finishedAt: 2,
      }],
      messages: [
        { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '已停止生成。', roundId: 'round-a', outputTaskIds: [agentTask.id], createdAt: 2 },
      ],
    })
    vi.mocked(getFalQueuedImageResult).mockResolvedValueOnce({
      images: ['data:image/png;base64,agent-recovered-after-stop'],
      actualParams: {},
      actualParamsList: [{}],
      revisedPrompts: [],
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [textProfile, imageProfile],
        activeProfileId: textProfile.id,
        agentApiConfigMode: 'hybrid',
        agentTextProfileId: textProfile.id,
        agentImageProfileId: imageProfile.id,
      }),
      tasks: [],
      agentConversations: [],
      activeAgentConversationId: 'conversation-a',
      showToast: vi.fn(),
    })
    await putDbTask(agentTask)
    await putAgentConversation(conversation)

    await initStore()
    for (let i = 0; i < 20 && useStore.getState().tasks.find((item) => item.id === agentTask.id)?.falRecoverable !== false; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(callAgentResponsesApi).not.toHaveBeenCalled()
    expect(useStore.getState().tasks.find((item) => item.id === agentTask.id)).toMatchObject({ status: 'done', falRecoverable: false })
    expect(useStore.getState().agentConversations[0].rounds[0]).toMatchObject({ status: 'error', error: '已停止生成。' })
  })

  it('does not overwrite a stopped Agent task when an in-flight fal recovery completes', async () => {
    const agentTask = task({
      id: 'agent-fal-task',
      prompt: '画一只猫',
      apiProvider: 'fal',
      apiProfileId: 'fal-profile',
      apiProfileName: 'fal',
      apiModel: 'fal-model',
      status: 'error',
      error: '与 fal.ai 的连接已断开，之后会继续查询任务结果。',
      falRequestId: 'fal-request-id',
      falEndpoint: 'fal-endpoint',
      falRecoverable: true,
      sourceMode: 'agent',
      agentConversationId: 'conversation-a',
      agentRoundId: 'round-a',
      agentMessageId: 'assistant-a',
      agentToolCallId: 'tool-a',
      finishedAt: Date.now(),
      elapsed: 10,
    })
    let resolveRecovery: (value: Awaited<ReturnType<typeof getFalQueuedImageResult>>) => void = () => {}
    vi.mocked(getFalQueuedImageResult).mockImplementationOnce(() => new Promise((resolve) => { resolveRecovery = resolve }))
    const conversation = agentConversation({
      id: 'conversation-a',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        prompt: '画一只猫',
        inputImageIds: [],
        outputTaskIds: [agentTask.id],
        status: 'running',
        error: null,
        createdAt: 1,
        finishedAt: null,
      }],
      messages: [
        { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '', roundId: 'round-a', outputTaskIds: [agentTask.id], createdAt: 2 },
      ],
    })
    useStore.setState({
      tasks: [],
      agentConversations: [],
      activeAgentConversationId: 'conversation-a',
      showToast: vi.fn(),
    })
    await putDbTask(agentTask)
    await putAgentConversation(conversation)

    await initStore()
    for (let i = 0; i < 20 && vi.mocked(getFalQueuedImageResult).mock.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    useStore.setState((state) => ({
      agentConversations: state.agentConversations.map((item) => item.id === 'conversation-a'
        ? { ...item, rounds: item.rounds.map((round) => round.id === 'round-a' ? { ...round, status: 'running', error: null } : round) }
        : item),
    }))
    stopAgentResponse('conversation-a')
    resolveRecovery({
      images: ['data:image/png;base64,should-not-write'],
      actualParams: {},
      actualParamsList: [{}],
      revisedPrompts: [],
    })
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    expect(useStore.getState().tasks[0]).toMatchObject({
      status: 'error',
      error: '已停止生成。',
      falRecoverable: false,
      outputImages: [],
    })
  })

  it('clears recoverable Agent image tasks when stopping the Agent round', () => {
    const agentTask = task({
      id: 'agent-fal-task',
      status: 'error',
      error: '与 fal.ai 的连接已断开，之后会继续查询任务结果。',
      falRequestId: 'fal-request-id',
      falEndpoint: 'fal-endpoint',
      falRecoverable: true,
      sourceMode: 'agent',
      agentConversationId: 'conversation-a',
      agentRoundId: 'round-a',
      agentMessageId: 'assistant-a',
      agentToolCallId: 'tool-a',
    })
    useStore.setState({
      tasks: [agentTask],
      activeAgentConversationId: 'conversation-a',
      agentConversations: [agentConversation({
        id: 'conversation-a',
        activeRoundId: 'round-a',
        rounds: [{
          id: 'round-a',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-a',
          assistantMessageId: 'assistant-a',
          prompt: '画一只猫',
          inputImageIds: [],
          outputTaskIds: [agentTask.id],
          status: 'running',
          error: null,
          createdAt: 1,
          finishedAt: null,
        }],
        messages: [
          { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', createdAt: 1 },
          { id: 'assistant-a', role: 'assistant', content: '', roundId: 'round-a', outputTaskIds: [agentTask.id], createdAt: 2 },
        ],
      })],
      showToast: vi.fn(),
    })

    stopAgentResponse('conversation-a')

    expect(useStore.getState().tasks[0]).toMatchObject({
      status: 'error',
      error: '已停止生成。',
      falRecoverable: false,
    })
    expect(useStore.getState().agentConversations[0].rounds[0]).toMatchObject({
      status: 'error',
      error: '已停止生成。',
    })
  })
})

describe('agent conversation creation', () => {
  beforeEach(() => {
    useStore.setState({
      agentConversations: [],
      activeAgentConversationId: null,
      agentSidebarCollapsed: false,
      agentEditingRoundId: null,
    })
  })

  it('refreshes the latest empty conversation instead of creating another one', () => {
    const olderEmpty = agentConversation({ id: 'older-empty', createdAt: 1_000, updatedAt: 1_000 })
    const latestEmpty = agentConversation({ id: 'latest-empty', createdAt: 2_000, updatedAt: 2_000 })
    const now = vi.spyOn(Date, 'now').mockReturnValue(3_000)
    useStore.setState({
      agentConversations: [olderEmpty, latestEmpty],
      activeAgentConversationId: olderEmpty.id,
      agentSidebarCollapsed: false,
      agentEditingRoundId: 'editing-round',
    })

    const id = useStore.getState().createAgentConversation()

    const state = useStore.getState()
    expect(id).toBe(latestEmpty.id)
    expect(state.activeAgentConversationId).toBe(latestEmpty.id)
    expect(state.agentConversations).toHaveLength(2)
    expect(state.agentConversations.find((item) => item.id === latestEmpty.id)).toMatchObject({
      createdAt: 3_000,
      updatedAt: 3_000,
    })
    expect(state.agentConversations.find((item) => item.id === olderEmpty.id)).toEqual(olderEmpty)
    expect(state.agentSidebarCollapsed).toBe(true)
    expect(state.agentEditingRoundId).toBeNull()
    now.mockRestore()
  })

  it('creates a new conversation when the latest conversation has messages', () => {
    const olderEmpty = agentConversation({ id: 'older-empty', createdAt: 1_000, updatedAt: 1_000 })
    const latestUsed = agentConversation({
      id: 'latest-used',
      activeRoundId: 'round-a',
      createdAt: 2_000,
      updatedAt: 2_000,
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'prompt',
        inputImageIds: [],
        outputTaskIds: [],
        status: 'done',
        error: null,
        createdAt: 2_000,
        finishedAt: 2_000,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'prompt', roundId: 'round-a', createdAt: 2_000 }],
    })
    const now = vi.spyOn(Date, 'now').mockReturnValue(3_000)
    useStore.setState({ agentConversations: [olderEmpty, latestUsed], activeAgentConversationId: latestUsed.id })

    const id = useStore.getState().createAgentConversation()

    const state = useStore.getState()
    expect(id).not.toBe(olderEmpty.id)
    expect(id).not.toBe(latestUsed.id)
    expect(state.agentConversations).toHaveLength(3)
    expect(state.agentConversations[state.agentConversations.length - 1]).toMatchObject({ id, createdAt: 3_000, updatedAt: 3_000, messages: [], rounds: [] })
    expect(state.activeAgentConversationId).toBe(id)
    now.mockRestore()
  })
})

describe('agent round deletion', () => {
  it('renumbers later rounds and remaps image mentions after deleting a middle round', () => {
    const conversation = agentConversation({
      activeRoundId: 'round-3',
      rounds: [
        {
          id: 'round-1',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-1',
          assistantMessageId: 'assistant-1',
          prompt: '第一轮',
          inputImageIds: [],
          outputTaskIds: ['task-1'],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        },
        {
          id: 'round-2',
          index: 2,
          parentRoundId: 'round-1',
          userMessageId: 'user-2',
          assistantMessageId: 'assistant-2',
          prompt: '第二轮',
          inputImageIds: [],
          outputTaskIds: ['task-2'],
          status: 'done',
          error: null,
          createdAt: 3,
          finishedAt: 4,
        },
        {
          id: 'round-3',
          index: 3,
          parentRoundId: 'round-2',
          userMessageId: 'user-3',
          assistantMessageId: 'assistant-3',
          prompt: '第三轮',
          inputImageIds: [],
          outputTaskIds: ['task-3'],
          status: 'done',
          error: null,
          createdAt: 5,
          finishedAt: 6,
        },
      ],
      messages: [
        { id: 'user-1', role: 'user', content: '第一轮', roundId: 'round-1', createdAt: 1 },
        { id: 'assistant-1', role: 'assistant', content: '完成', roundId: 'round-1', createdAt: 2 },
        { id: 'user-2', role: 'user', content: '第二轮', roundId: 'round-2', createdAt: 3 },
        { id: 'assistant-2', role: 'assistant', content: '完成', roundId: 'round-2', createdAt: 4 },
        { id: 'user-3', role: 'user', content: '参考 @第1轮图1、@第2轮图1、@第3轮图1', roundId: 'round-3', createdAt: 5 },
        { id: 'assistant-3', role: 'assistant', content: '完成', roundId: 'round-3', createdAt: 6 },
      ],
    })

    const deleted = deleteAgentRoundFromConversation(conversation, 'round-2', 10)

    expect(deleted.rounds.map((round) => ({ id: round.id, index: round.index, parentRoundId: round.parentRoundId }))).toEqual([
      { id: 'round-1', index: 1, parentRoundId: null },
      { id: 'round-3', index: 2, parentRoundId: 'round-1' },
    ])
    expect(deleted.messages.map((message) => message.id)).toEqual(['user-1', 'assistant-1', 'user-3', 'assistant-3'])
    expect(deleted.messages.find((message) => message.id === 'user-3')?.content).toBe('参考 @第1轮图1、@已删除轮次图1、@第2轮图1')
    expect(deleted.activeRoundId).toBe('round-3')
    expect(deleted.updatedAt).toBe(10)
  })

  it('can remap draft mentions using the old and new active paths after deletion', () => {
    const conversation = agentConversation({
      activeRoundId: 'round-3',
      rounds: [
        {
          id: 'round-1',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-1',
          prompt: '第一轮',
          inputImageIds: [],
          outputTaskIds: ['task-1'],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        },
        {
          id: 'round-2',
          index: 2,
          parentRoundId: 'round-1',
          userMessageId: 'user-2',
          prompt: '第二轮',
          inputImageIds: [],
          outputTaskIds: ['task-2'],
          status: 'done',
          error: null,
          createdAt: 3,
          finishedAt: 4,
        },
        {
          id: 'round-3',
          index: 3,
          parentRoundId: 'round-2',
          userMessageId: 'user-3',
          prompt: '第三轮',
          inputImageIds: [],
          outputTaskIds: ['task-3'],
          status: 'done',
          error: null,
          createdAt: 5,
          finishedAt: 6,
        },
      ],
      messages: [],
    })
    const oldPath = getActiveAgentRounds(conversation)
    const deleted = deleteAgentRoundFromConversation(conversation, 'round-2', 10)
    const newPath = getActiveAgentRounds(deleted)

    expect(remapAgentRoundMentionsForPathChange('继续参考 @第1轮图1、@第2轮图1、@第3轮图1', oldPath, newPath))
      .toBe('继续参考 @第1轮图1、@已删除轮次图1、@第2轮图1')
  })

  it('collects agent round and conversation tasks even when some failed tasks are not in outputTaskIds', () => {
    const conversation = agentConversation({
      id: 'conversation-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'user-a',
        assistantMessageId: 'assistant-a',
        prompt: '第一轮',
        inputImageIds: [],
        outputTaskIds: ['task-success'],
        status: 'done',
        error: null,
        createdAt: 1,
        finishedAt: 2,
      }],
      messages: [],
    })
    const tasks = [
      task({ id: 'task-success', agentConversationId: 'conversation-a', agentRoundId: 'round-a', status: 'done', outputImages: ['image-a'] }),
      task({ id: 'task-failed', agentConversationId: 'conversation-a', agentRoundId: 'round-a', status: 'error', error: '失败' }),
      task({ id: 'task-unrelated', agentConversationId: 'other', agentRoundId: 'other-round', status: 'error', error: '失败' }),
    ]

    expect(getAgentRoundTaskIds(conversation.rounds[0], tasks)).toEqual(['task-success', 'task-failed'])
    expect(getAgentConversationTaskIds(conversation, tasks)).toEqual(['task-success', 'task-failed'])
  })
})

describe('data import', () => {
  beforeEach(async () => {
    useStore.setState({
      tasks: [],
      agentConversations: [],
      activeAgentConversationId: null,
      showToast: vi.fn(),
    })
    await clearAgentConversations()
    await clearPromptProjects()
  })

  it('migrates prompt projects and keeps both sides of an id conflict', async () => {
    const local = promptProject({ id: 'shared-project', title: '本地项目' })
    const importedVersion = {
      id: 'version-a',
      artifact: { domain: 'image', title: '版本', prompt: '完整提示词', params: {} },
      source: 'model' as const,
      createdAt: 2,
    }
    const incoming = {
      ...promptProject({
        id: 'shared-project',
        title: '导入项目',
        source: {
          type: 'conversation',
          assets: [{ id: 'project-image', type: 'image' as const, label: '主体参考' }],
        },
        versions: [importedVersion],
        activeVersionId: importedVersion.id,
      }),
      schemaVersion: 0,
    }
    const child = promptProject({
      id: 'child-project',
      title: '关联项目',
      source: { type: 'project', id: incoming.id },
    })
    await putPromptProject(local)

    const imported = await importData(importFile({
      version: 4,
      exportedAt: new Date(0).toISOString(),
      promptProjects: [incoming as unknown as PromptProject, child],
      imageFiles: {},
    }), { importConfig: false, importTasks: false, importPromptProjects: true })

    const projects = await getAllPromptProjects()
    const restored = projects.find((project) => project.title === incoming.title)
    const restoredChild = projects.find((project) => project.id === child.id)
    expect(imported).toBe(true)
    expect(projects).toHaveLength(3)
    expect(projects.find((project) => project.id === local.id)?.title).toBe(local.title)
    expect(restored?.id).not.toBe(local.id)
    expect(restored?.schemaVersion).toBe(1)
    expect(restored?.versions).toEqual([importedVersion])
    expect(restored?.source.assets).toEqual(incoming.source.assets)
    expect(restoredChild?.source.id).toBe(restored?.id)
  })

  it('round-trips project versions, asset refs and project-only images through ZIP', async () => {
    const version = {
      id: 'version-a',
      artifact: { domain: 'image', title: '版本', prompt: '完整提示词', params: { quality: 'high' } },
      source: 'model' as const,
      createdAt: 2,
    }
    const project = promptProject({
      id: 'roundtrip-project',
      source: {
        type: 'conversation',
        assets: [{ id: 'roundtrip-image', type: 'image', label: '主体参考', role: 'subject', width: 1200, height: 800 }],
      },
      versions: [version],
      activeVersionId: version.id,
    })
    const image = {
      id: 'roundtrip-image',
      dataUrl: 'data:image/png;base64,AAECAw==',
      source: 'upload' as const,
      createdAt: 1700000000000,
    }
    const { bytes } = buildExportZip({
      options: { exportPromptProjects: true },
      exportedAt: 1700000001000,
      settings: DEFAULT_SETTINGS,
      tasks: [],
      images: [image],
      thumbnailsByImageId: new Map(),
      favoriteCollections: [],
      defaultFavoriteCollectionId: null,
      agentConversations: [],
      promptProjects: [project],
    })

    const imported = await importData(importZip(bytes), {
      importConfig: false,
      importTasks: false,
      importPromptProjects: true,
    })

    expect(imported).toBe(true)
    expect(await getAllPromptProjects()).toEqual([project])
    expect(await getImage(image.id)).toEqual(expect.objectContaining(image))
  })

  it('restores favorite collections and default collection when importing task data', async () => {
    await clearTasks()
    const importedCollections = [
      { id: 'imported-collection-a', name: '导入素材集 A', createdAt: 1, updatedAt: 1 },
      { id: 'imported-collection-b', name: '导入素材集 B', createdAt: 2, updatedAt: 2 },
    ]
    const importedTask = task({
      id: 'imported-favorite-task',
      isFavorite: true,
      favoriteCollectionIds: [importedCollections[1].id],
    })

    const imported = await importData(importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      tasks: [importedTask],
      favoriteCollections: importedCollections,
      defaultFavoriteCollectionId: importedCollections[1].id,
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(state.favoriteCollections).toEqual(expect.arrayContaining(importedCollections))
    expect(state.defaultFavoriteCollectionId).toBe(importedCollections[1].id)
    expect(state.tasks.find((item) => item.id === importedTask.id)).toMatchObject({
      favoriteCollectionIds: [importedCollections[1].id],
      isFavorite: true,
    })
    expect((await getAllTasks()).find((item) => item.id === importedTask.id)).toMatchObject({
      favoriteCollectionIds: [importedCollections[1].id],
      isFavorite: true,
    })
  })

  it('skips empty agent conversations when importing task data', async () => {
    const usedConversation = agentConversation({
      id: 'used-conversation',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'prompt',
        inputImageIds: [],
        outputTaskIds: [],
        status: 'done',
        error: null,
        createdAt: 1,
        finishedAt: 2,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'prompt', roundId: 'round-a', createdAt: 1 }],
    })

    const imported = await importData(importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      tasks: [],
      agentConversations: [
        agentConversation({ id: 'empty-conversation' }),
        usedConversation,
      ],
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['used-conversation'])
    expect(state.activeAgentConversationId).toBe('used-conversation')
  })

  it('merges imported agent conversations without replacing local conversations', async () => {
    const localConversation = agentConversation({
      id: 'local-conversation',
      title: '本地对话',
      createdAt: 1,
      updatedAt: 1,
    })
    const importedConversation = agentConversation({
      id: 'imported-conversation',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'imported prompt',
        inputImageIds: [],
        outputTaskIds: [],
        status: 'done',
        error: null,
        createdAt: 2,
        finishedAt: 3,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'imported prompt', roundId: 'round-a', createdAt: 2 }],
    })
    useStore.setState({
      agentConversations: [localConversation],
      activeAgentConversationId: localConversation.id,
    })

    const imported = await importData(importFile({
      version: 3,
      exportedAt: new Date(0).toISOString(),
      tasks: [],
      agentConversations: [importedConversation],
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    const state = useStore.getState()
    expect(imported).toBe(true)
    expect(state.agentConversations.map((conversation) => conversation.id)).toEqual(['local-conversation', 'imported-conversation'])
    expect(state.activeAgentConversationId).toBe('local-conversation')
  })

  it('stores imported legacy agent conversations in IndexedDB without localStorage or image payloads', async () => {
    const importedConversation = agentConversation({
      id: 'legacy-imported-conversation',
      activeRoundId: 'round-a',
      rounds: [{
        id: 'round-a',
        index: 1,
        parentRoundId: null,
        userMessageId: 'message-a',
        prompt: 'imported prompt',
        inputImageIds: [],
        outputTaskIds: ['task-a'],
        responseOutput: [
          { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
          { type: 'image_generation_call', id: 'image-call-a', result: { base64: 'imported-legacy-base64' } },
        ],
        status: 'done',
        error: null,
        createdAt: 2,
        finishedAt: 3,
      }],
      messages: [{ id: 'message-a', role: 'user', content: 'imported prompt', roundId: 'round-a', createdAt: 2 }],
    })

    const imported = await importData(importFile({
      version: 2,
      exportedAt: new Date(0).toISOString(),
      tasks: [],
      agentConversations: [importedConversation],
      imageFiles: {},
    }), { importConfig: false, importTasks: true })

    const indexedConversations = await getAllAgentConversations()
    const persisted = getPersistedState(useStore.getState())
    const serializedIndexedConversations = JSON.stringify(indexedConversations)
    const serializedPersisted = JSON.stringify(persisted)

    expect(imported).toBe(true)
    expect(indexedConversations.map((conversation) => conversation.id)).toEqual(['legacy-imported-conversation'])
    expect(serializedIndexedConversations).toContain('image_generation_call')
    expect(serializedIndexedConversations).not.toContain('imported-legacy-base64')
    expect('agentConversations' in persisted).toBe(false)
    expect(serializedPersisted).not.toContain('image_generation_call')
    expect(serializedPersisted).not.toContain('imported-legacy-base64')
  })

})

describe('agent draft lifecycle', () => {
  const responsesProfile = createDefaultOpenAIProfile({ id: 'openai-responses', apiKey: 'openai-key', apiMode: 'responses' })
  const draftState = {
    prompt: `参考 ${getSelectedImageMentionLabel(0)} 生成`,
    inputImages: [imageA],
    maskDraft: {
      targetImageId: imageA.id,
      maskDataUrl: 'data:image/png;base64,mask',
      updatedAt: 1,
    },
    maskEditorImageId: imageA.id,
    agentEditingRoundId: 'round-a',
  }

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
      }),
      appMode: 'agent',
      agentConversations: [
        agentConversation({ id: 'conversation-a' }),
        agentConversation({ id: 'conversation-b' }),
      ],
      activeAgentConversationId: 'conversation-a',
      galleryInputDraft: null,
      agentInputDrafts: {},
      agentSidebarCollapsed: false,
      agentAssetPanelCollapsed: false,
      ...draftState,
    })
  })

  it('clears visible input but keeps the agent draft when returning to gallery mode', () => {
    useStore.getState().setAppMode('gallery')

    const state = useStore.getState()
    expect(state.appMode).toBe('gallery')
    expect(state.prompt).toBe('')
    expect(state.inputImages).toEqual([])
    expect(state.maskDraft).toBeNull()
    expect(state.maskEditorImageId).toBeNull()
    expect(state.agentEditingRoundId).toBeNull()
    expect(state.agentInputDrafts['conversation-a']).toMatchObject({
      prompt: draftState.prompt,
      inputImages: draftState.inputImages,
      maskDraft: draftState.maskDraft,
      maskEditorImageId: imageA.id,
    })
  })

  it('restores the agent draft when switching back from gallery mode', () => {
    useStore.getState().setAppMode('gallery')
    useStore.getState().setAppMode('agent')

    const state = useStore.getState()
    expect(state.appMode).toBe('agent')
    expect(state.prompt).toBe(draftState.prompt)
    expect(state.inputImages).toEqual(draftState.inputImages)
    expect(state.maskDraft).toEqual(draftState.maskDraft)
    expect(state.maskEditorImageId).toBe(imageA.id)
    expect(state.agentEditingRoundId).toBeNull()
  })

  it('keeps the gallery draft when switching into agent mode and back', () => {
    const galleryPrompt = `画廊 ${getSelectedImageMentionLabel(0)} 草稿`
    useStore.setState({
      appMode: 'gallery',
      prompt: galleryPrompt,
      inputImages: [imageB],
      maskDraft: null,
      maskEditorImageId: null,
      galleryInputDraft: null,
      agentInputDrafts: {
        'conversation-a': {
          prompt: draftState.prompt,
          inputImages: draftState.inputImages,
          maskDraft: draftState.maskDraft,
          maskEditorImageId: imageA.id,
        },
      },
    })

    useStore.getState().setAppMode('agent')

    let state = useStore.getState()
    expect(state.appMode).toBe('agent')
    expect(state.galleryInputDraft).toMatchObject({ prompt: galleryPrompt, inputImages: [imageB] })
    expect(state.prompt).toBe(draftState.prompt)

    useStore.getState().setAppMode('gallery')

    state = useStore.getState()
    expect(state.appMode).toBe('gallery')
    expect(state.prompt).toBe(galleryPrompt)
    expect(state.inputImages).toEqual([imageB])
  })

  it('persists the gallery draft while agent mode is active', () => {
    const galleryPrompt = 'gallery draft'
    useStore.setState({
      appMode: 'agent',
      galleryInputDraft: {
        prompt: galleryPrompt,
        inputImages: [imageB],
        maskDraft: null,
        maskEditorImageId: null,
      },
    })

    const persisted = getPersistedState(useStore.getState())

    expect(persisted.prompt).toBe(galleryPrompt)
    expect(persisted.inputImages).toEqual([{ id: imageB.id, dataUrl: '' }])
  })

  it('clears stale mentions in the visible input when switching conversations', () => {
    useStore.getState().setActiveAgentConversationId('conversation-b')

    const state = useStore.getState()
    expect(state.activeAgentConversationId).toBe('conversation-b')
    expect(state.prompt).toBe('')
    expect(state.inputImages).toEqual([])
    expect(state.maskDraft).toBeNull()
    expect(state.maskEditorImageId).toBeNull()
    expect(state.agentEditingRoundId).toBeNull()
    expect(state.agentInputDrafts['conversation-a']?.prompt).toBe(draftState.prompt)
  })

  it('restores the previous conversation draft when switching back', () => {
    useStore.getState().setActiveAgentConversationId('conversation-b')
    useStore.getState().setActiveAgentConversationId('conversation-a')

    const state = useStore.getState()
    expect(state.activeAgentConversationId).toBe('conversation-a')
    expect(state.prompt).toBe(draftState.prompt)
    expect(state.inputImages).toEqual(draftState.inputImages)
    expect(state.maskDraft).toEqual(draftState.maskDraft)
    expect(state.maskEditorImageId).toBe(imageA.id)
    expect(state.agentEditingRoundId).toBeNull()
  })

  it('keeps the current draft when selecting the already active conversation', () => {
    useStore.getState().setActiveAgentConversationId('conversation-a')

    const state = useStore.getState()
    expect(state.prompt).toBe(draftState.prompt)
    expect(state.inputImages).toEqual(draftState.inputImages)
    expect(state.maskDraft).toEqual(draftState.maskDraft)
    expect(state.maskEditorImageId).toBe(imageA.id)
  })

  it('persists agent drafts separately from the gallery input draft', () => {
    const persisted = getPersistedState(useStore.getState())

    expect(persisted).not.toHaveProperty('prompt')
    expect(persisted.agentInputDrafts['conversation-a']).toMatchObject({
      prompt: draftState.prompt,
      inputImages: [{ id: imageA.id, dataUrl: '' }],
      maskDraft: draftState.maskDraft,
      maskEditorImageId: imageA.id,
    })
    expect(persisted.agentInputDrafts['conversation-a']?.updatedAt).toEqual(expect.any(Number))
  })

  it('removes stale agent drafts except the last active conversation', () => {
    const now = 10 * 24 * 60 * 60 * 1000
    const staleUpdatedAt = now - 3 * 24 * 60 * 60 * 1000 - 1
    const recentUpdatedAt = now - 3 * 24 * 60 * 60 * 1000
    const activeDraft = { prompt: 'active', inputImages: [], maskDraft: null, maskEditorImageId: null, updatedAt: staleUpdatedAt }
    const staleDraft = { prompt: 'stale', inputImages: [], maskDraft: null, maskEditorImageId: null, updatedAt: staleUpdatedAt }
    const recentDraft = { prompt: 'recent', inputImages: [], maskDraft: null, maskEditorImageId: null, updatedAt: recentUpdatedAt }

    const cleaned = cleanStaleAgentInputDrafts({
      'conversation-a': activeDraft,
      'conversation-b': staleDraft,
      'conversation-c': recentDraft,
    }, 'conversation-a', now)

    expect(cleaned).toEqual({
      'conversation-a': activeDraft,
      'conversation-c': recentDraft,
    })
  })

})

describe('agent round editing contract', () => {
  it('creates a sibling round without changing the completed source round', async () => {
    const profile = createDefaultOpenAIProfile({
      id: 'responses-profile',
      apiKey: 'test-key',
      apiMode: 'responses',
      model: DEFAULT_RESPONSES_MODEL,
    })
    const sourceRound = {
      id: 'round-a',
      index: 1,
      parentRoundId: null,
      userMessageId: 'user-a',
      assistantMessageId: 'assistant-a',
      prompt: '白天街道',
      inputImageIds: [],
      outputTaskIds: [],
      status: 'done' as const,
      error: null,
      createdAt: 1,
      finishedAt: 2,
    }
    const conversation = agentConversation({
      activeRoundId: sourceRound.id,
      rounds: [sourceRound],
      messages: [
        { id: 'user-a', role: 'user', content: sourceRound.prompt, roundId: sourceRound.id, createdAt: 1 },
        { id: 'assistant-a', role: 'assistant', content: '原回复', roundId: sourceRound.id, createdAt: 2 },
      ],
    })
    vi.mocked(callAgentResponsesApi).mockResolvedValueOnce({
      responseId: 'response-edited',
      text: '新回复',
      images: [],
      outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '新回复' }] }],
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [profile],
        activeProfileId: profile.id,
      }),
      appMode: 'agent',
      prompt: '改成雨夜街道',
      inputImages: [imageA],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      agentConversations: [conversation],
      activeAgentConversationId: conversation.id,
      agentEditingRoundId: sourceRound.id,
      showToast: vi.fn(),
    })

    await submitAgentMessage()
    for (let i = 0; i < 10 && useStore.getState().agentConversations[0].rounds.some((round) => round.status === 'running'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const state = useStore.getState()
    const updated = state.agentConversations[0]
    const sibling = updated.rounds.find((round) => round.id !== sourceRound.id)
    expect(updated.rounds).toHaveLength(2)
    expect(updated.rounds.find((round) => round.id === sourceRound.id)).toEqual(sourceRound)
    expect(sibling).toMatchObject({
      parentRoundId: null,
      prompt: '改成雨夜街道',
      inputImageIds: [imageA.id],
      status: 'done',
      responseId: 'response-edited',
    })
    expect(updated.activeRoundId).toBe(sibling?.id)
    expect(state.agentEditingRoundId).toBeNull()
  })
})

describe('agent context for removed outputs', () => {
  beforeEach(() => {
    const profile = createDefaultOpenAIProfile({
      id: 'responses-profile',
      apiKey: 'test-key',
      apiMode: 'responses',
      model: DEFAULT_RESPONSES_MODEL,
    })
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        model: DEFAULT_RESPONSES_MODEL,
        profiles: [profile],
        activeProfileId: profile.id,
      }),
      prompt: '继续',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      appMode: 'agent',
      tasks: [task({
        id: 'task-live',
        outputImages: ['image-live'],
        sourceMode: 'agent',
        agentRoundId: 'round-a',
        agentToolCallId: 'live-call',
      })],
      agentConversations: [agentConversation({
        id: 'conversation-a',
        activeRoundId: 'round-a',
        rounds: [{
          id: 'round-a',
          index: 1,
          parentRoundId: null,
          userMessageId: 'user-a',
          assistantMessageId: 'assistant-a',
          prompt: '画两张图',
          inputImageIds: [],
          outputTaskIds: ['task-deleted', 'task-live'],
          responseOutput: [
            { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
            { type: 'image_generation_call', id: 'deleted-call', result: 'deleted-base64' },
            { type: 'image_generation_call', id: 'live-call', result: 'live-base64' },
          ],
          status: 'done',
          error: null,
          createdAt: 1,
          finishedAt: 2,
        }],
        messages: [
          { id: 'user-a', role: 'user', content: '画两张图', roundId: 'round-a', createdAt: 1 },
          { id: 'assistant-a', role: 'assistant', content: '已生成两张图。', roundId: 'round-a', outputTaskIds: ['task-deleted', 'task-live'], createdAt: 2 },
        ],
      })],
      activeAgentConversationId: 'conversation-a',
      agentEditingRoundId: null,
      showToast: vi.fn(),
    })
    vi.mocked(callAgentResponsesApi).mockClear()
    vi.mocked(callAgentResponsesApi).mockResolvedValue({
      text: 'ok',
      images: [],
      outputItems: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
      responseId: 'response-b',
    })
  })

  it('does not send removed image_generation results back to the model', async () => {
    await putImage({ id: 'image-live', dataUrl: 'data:image/png;base64,live-base64' })
    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).not.toContain('deleted-base64')
    expect(serializedInput).toContain('live-base64')
    expect(serializedInput).not.toContain('deleted-call')
    expect(serializedInput).not.toContain('live-call')
    expect(serializedInput).not.toContain('image_generation_call')
    expect(serializedInput).toContain('removed_ref')
    expect(serializedInput).toContain('round-1-image-1')
    expect(serializedInput).toContain('round-1-image-2')
    expect(serializedInput).toContain('input_image')
  })

  it('restores stripped image_generation results from task payloads when building context', async () => {
    await putImage({ id: 'image-live', dataUrl: 'data:image/png;base64,live-base64' })
    const rawResponsePayload = JSON.stringify({
      output: [
        { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
        { type: 'image_generation_call', id: 'deleted-call', result: 'deleted-base64' },
        { type: 'image_generation_call', id: 'live-call', result: 'live-base64' },
      ],
    }, null, 2)
    useStore.setState((state) => ({
      tasks: [task({
        id: 'task-live',
        outputImages: ['image-live'],
        rawResponsePayload,
        sourceMode: 'agent',
        agentRoundId: 'round-a',
        agentToolCallId: 'live-call',
      })],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              responseOutput: [
                { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
                { type: 'image_generation_call', id: 'deleted-call' },
                { type: 'image_generation_call', id: 'live-call' },
              ],
            }
          : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('live-base64')
    expect(serializedInput).toContain('input_image')
    expect(serializedInput).not.toContain('deleted-base64')
    expect(serializedInput).not.toContain('live-call')
    expect(serializedInput).not.toContain('image_generation_call')
  })

  it('hydrates stripped task payload image results from stored images when building context', async () => {
    await putImage({ id: 'image-hydrate', dataUrl: 'data:image/png;base64,hydrated-live-base64' })
    const rawResponsePayload = JSON.stringify({
      output: [{ type: 'image_generation_call' }],
    }, null, 2)
    useStore.setState((state) => ({
      tasks: [task({
        id: 'task-live',
        outputImages: ['image-hydrate'],
        rawResponsePayload,
        sourceMode: 'agent',
        agentRoundId: 'round-a',
      })],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              outputTaskIds: ['task-live'],
              responseOutput: [{ type: 'image_generation_call' }],
            }
          : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('hydrated-live-base64')
  })

  it('restores stripped image results even when legacy tasks lack tool call ids', async () => {
    await putImage({ id: 'image-legacy', dataUrl: 'data:image/png;base64,legacy-live-base64' })
    const rawResponsePayload = JSON.stringify({
      output: [
        { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
        { type: 'image_generation_call', result: { base64: 'legacy-live-base64' } },
      ],
    }, null, 2)
    useStore.setState((state) => ({
      tasks: [task({
        id: 'legacy-task-live',
        outputImages: ['image-legacy'],
        rawResponsePayload,
        sourceMode: 'agent',
        agentRoundId: 'round-a',
        agentToolCallId: undefined,
      })],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              outputTaskIds: ['legacy-task-live'],
              responseOutput: [
                { type: 'message', content: [{ type: 'output_text', text: '已生成图片。' }] },
                { type: 'image_generation_call' },
              ],
            }
          : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('legacy-live-base64')
    expect(serializedInput).toContain('input_image')
    expect(serializedInput).not.toContain('image_generation_call')
    expect(serializedInput.match(/已生成图片。/g)).toHaveLength(1)
  })

  it('restores all stripped batch image results after restart', async () => {
    await putImage({ id: 'image-batch-1', dataUrl: 'data:image/png;base64,batch-base64-1' })
    await putImage({ id: 'image-batch-2', dataUrl: 'data:image/png;base64,batch-base64-2' })
    const batchOnePayload = JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'batch-call-1', result: 'batch-base64-1' }],
    }, null, 2)
    const batchTwoPayload = JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'batch-call-2', result: 'batch-base64-2' }],
    }, null, 2)
    useStore.setState((state) => ({
      tasks: [
        task({
          id: 'task-batch-1',
          outputImages: ['image-batch-1'],
          rawResponsePayload: batchOnePayload,
          sourceMode: 'agent',
          agentRoundId: 'round-a',
          agentToolCallId: 'batch-call-1',
          agentBatchCallId: 'batch-fc-1',
        }),
        task({
          id: 'task-batch-2',
          outputImages: ['image-batch-2'],
          rawResponsePayload: batchTwoPayload,
          sourceMode: 'agent',
          agentRoundId: 'round-a',
          agentToolCallId: 'batch-call-2',
          agentBatchCallId: 'batch-fc-1',
        }),
      ],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              outputTaskIds: ['task-batch-1', 'task-batch-2'],
              responseOutput: [
                { type: 'function_call', name: 'generate_image_batch', call_id: 'batch-fc-1', arguments: '{}' },
                { type: 'function_call_output', call_id: 'batch-fc-1', output: '{"images":[{"id":"1","status":"done"},{"id":"2","status":"done"}]}' },
                { type: 'image_generation_call' },
                { type: 'image_generation_call' },
              ],
            }
          : round,
        ),
      })),
    }))

    await submitAgentMessage()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const input = vi.mocked(callAgentResponsesApi).mock.calls[0][0].input
    const serializedInput = JSON.stringify(input)
    expect(serializedInput).toContain('batch-base64-1')
    expect(serializedInput).toContain('batch-base64-2')
    expect(serializedInput).toContain('input_image')
    expect(serializedInput).not.toContain('batch-call-1')
    expect(serializedInput).not.toContain('batch-call-2')
    expect(serializedInput).not.toContain('image_generation_call')
  })

  it('scrubs stored agent response payloads when deleting an output task', async () => {
    const rawResponsePayload = JSON.stringify({
      output: [
        { type: 'message', content: [{ type: 'output_text', text: '已生成两张图。' }] },
        { type: 'image_generation_call', id: 'deleted-call', result: 'deleted-base64' },
        { type: 'image_generation_call', id: 'live-call', result: 'live-base64' },
      ],
    }, null, 2)
    const deletedTask = task({
      id: 'task-deleted',
      outputImages: ['image-deleted'],
      rawResponsePayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'deleted-call',
    })
    const liveTask = task({
      id: 'task-live',
      outputImages: ['image-live'],
      rawResponsePayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'live-call',
    })
    useStore.setState((state) => ({
      tasks: [deletedTask, liveTask],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? { ...round, outputTaskIds: ['task-deleted', 'task-live'], responseOutput: JSON.parse(rawResponsePayload).output }
          : round,
        ),
      })),
    }))

    await removeTask(deletedTask)

    const state = useStore.getState()
    const serializedConversations = JSON.stringify(state.agentConversations)
    const remainingTaskPayload = state.tasks.find((item) => item.id === 'task-live')?.rawResponsePayload ?? ''
    expect(serializedConversations).not.toContain('deleted-base64')
    expect(remainingTaskPayload).not.toContain('deleted-base64')
    expect(serializedConversations).toContain('live-base64')
    expect(remainingTaskPayload).toContain('live-base64')
  })

  it('does not corrupt batch task payloads when deleting one of the batch tasks', async () => {
    const batchDeletedPayload = JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'batch-deleted-call', result: 'batch-deleted-base64' }],
    }, null, 2)
    const batchLivePayload = JSON.stringify({
      output: [{ type: 'image_generation_call', id: 'batch-live-call', result: 'batch-live-base64' }],
    }, null, 2)
    const batchDeletedTask = task({
      id: 'batch-task-deleted',
      outputImages: ['batch-img-deleted'],
      rawResponsePayload: batchDeletedPayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'batch-deleted-call',
      agentBatchCallId: 'batch-fc-1',
    })
    const batchLiveTask = task({
      id: 'batch-task-live',
      outputImages: ['batch-img-live'],
      rawResponsePayload: batchLivePayload,
      sourceMode: 'agent',
      agentRoundId: 'round-a',
      agentToolCallId: 'batch-live-call',
      agentBatchCallId: 'batch-fc-1',
    })
    useStore.setState((state) => ({
      tasks: [batchDeletedTask, batchLiveTask],
      agentConversations: state.agentConversations.map((conversation) => ({
        ...conversation,
        rounds: conversation.rounds.map((round) => round.id === 'round-a'
          ? {
              ...round,
              outputTaskIds: ['batch-task-deleted', 'batch-task-live'],
              responseOutput: [
                { type: 'function_call', name: 'generate_image_batch', call_id: 'batch-fc-1', arguments: '{}' },
                { type: 'function_call_output', call_id: 'batch-fc-1', output: '{"images":[{"id":"1","status":"done"},{"id":"2","status":"done"}]}' },
              ],
            }
          : round,
        ),
      })),
    }))

    await removeTask(batchDeletedTask)

    const state = useStore.getState()
    const liveTaskPayload = state.tasks.find((item) => item.id === 'batch-task-live')?.rawResponsePayload ?? ''
    expect(liveTaskPayload).toContain('batch-live-base64')
    expect(liveTaskPayload).not.toContain('batch-deleted-base64')
    const serializedConversations = JSON.stringify(state.agentConversations)
    expect(serializedConversations).toContain('function_call_output')
    expect(serializedConversations).not.toContain('batch-deleted-base64')
  })

  it('clears only failed gallery tasks', async () => {
    const failedA = task({ id: 'failed-a', status: 'error', error: '生成失败', outputImages: ['failed-image-a'] })
    const failedB = task({ id: 'failed-b', status: 'error', error: '生成失败', outputImages: ['failed-image-b'] })
    const done = task({ id: 'done-task', status: 'done', outputImages: ['done-image'] })
    const running = task({ id: 'running-task', status: 'running', finishedAt: null, elapsed: null })
    useStore.setState({
      tasks: [failedA, done, failedB, running],
      selectedTaskIds: ['failed-a', 'done-task', 'failed-b'],
      showToast: vi.fn(),
    })

    await clearFailedTasks()

    const state = useStore.getState()
    expect(state.tasks.map((item) => item.id)).toEqual(['done-task', 'running-task'])
    expect(state.selectedTaskIds).toEqual(['done-task'])
    expect(state.showToast).toHaveBeenCalledWith('已删除 2 个任务', 'success')
  })

  it('matches partial failures in failed filters and searches error text', () => {
    const partial = task({
      id: 'partial-task',
      status: 'done',
      outputImages: ['done-image-a', 'done-image-b'],
      outputErrors: [{ requestIndex: 2, error: 'Failed to fetch' }],
    })

    expect(taskMatchesFilterStatus(partial, 'error')).toBe(true)
    expect(taskMatchesFilterStatus(partial, 'done')).toBe(true)
    expect(taskMatchesSearchQuery(partial, 'failed to fetch')).toBe(true)
  })

  it('clears partial failure markers without deleting successful outputs', async () => {
    const partial = task({
      id: 'partial-task',
      status: 'done',
      outputImages: ['done-image-a'],
      outputErrors: [{ requestIndex: 1, error: 'Failed to fetch' }],
    })
    useStore.setState({ tasks: [partial], selectedTaskIds: ['partial-task'], showToast: vi.fn() })

    await clearFailedTasks(['partial-task'])

    const state = useStore.getState()
    expect(state.tasks).toHaveLength(1)
    expect(state.tasks[0]).toMatchObject({ id: 'partial-task', outputImages: ['done-image-a'], outputErrors: undefined })
    expect(state.selectedTaskIds).toEqual([])
    expect(state.showToast).toHaveBeenCalledWith('已清除 1 条部分失败记录', 'success')
  })

  it('keeps failed tasks created after the cleanup snapshot', async () => {
    const failedAtConfirmOpen = task({ id: 'failed-at-confirm-open', status: 'error', error: '生成失败' })
    const failedAfterConfirmOpen = task({ id: 'failed-after-confirm-open', status: 'error', error: '生成失败' })
    useStore.setState({ tasks: [failedAtConfirmOpen] })
    const failedTaskIds = useStore.getState().tasks
      .filter((item) => item.status === 'error')
      .map((item) => item.id)
    useStore.setState({ tasks: [failedAtConfirmOpen, failedAfterConfirmOpen] })

    await clearFailedTasks(failedTaskIds)

    expect(useStore.getState().tasks.map((item) => item.id)).toEqual(['failed-after-confirm-open'])
  })
})

describe('agent built-in image tool failure', () => {
  const responsesProfile = createDefaultOpenAIProfile({
    id: 'responses-profile',
    apiKey: 'test-key',
    apiMode: 'responses',
    model: DEFAULT_RESPONSES_MODEL,
    streamImages: true,
  })

  beforeEach(async () => {
    await clearTasks()
    await clearImages()
    await clearAgentConversations()
    vi.mocked(callAgentResponsesApi).mockClear()
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        model: DEFAULT_RESPONSES_MODEL,
        streamImages: true,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
      }),
      prompt: '画一张图',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      appMode: 'agent',
      tasks: [],
      streamPreviews: {},
      streamPreviewSlots: {},
      agentConversations: [agentConversation({
        id: 'conversation-a',
        activeRoundId: null,
        rounds: [],
        messages: [],
      })],
      activeAgentConversationId: 'conversation-a',
      agentEditingRoundId: null,
      showToast: vi.fn(),
    })
  })

  it('marks a started built-in image task as error when the stream fails', async () => {
    vi.mocked(callAgentResponsesApi).mockImplementationOnce(async (opts) => {
      await opts.onImageToolStarted?.({ toolCallId: 'ig-fail' })
      await opts.onImagePartialImage?.({
        toolCallId: 'ig-fail',
        image: 'data:image/png;base64,cGFydGlhbA==',
        partialImageIndex: 0,
      })
      throw new Error('image_generation failed')
    })

    await submitAgentMessage()
    for (let i = 0; i < 10 && useStore.getState().tasks[0]?.status !== 'error'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const state = useStore.getState()
    const failedTask = state.tasks[0]
    expect(failedTask).toMatchObject({
      status: 'error',
      error: 'image_generation failed',
      agentToolCallId: 'ig-fail',
      sourceMode: 'agent',
    })
    expect(state.streamPreviews[failedTask.id]).toBeUndefined()
    expect(state.streamPreviewSlots[failedTask.id]).toBeUndefined()

    const round = state.agentConversations[0].rounds[0]
    expect(round).toMatchObject({
      status: 'error',
      error: 'image_generation failed',
      outputTaskIds: [failedTask.id],
    })
  })

  it('marks a failed built-in image task as error while the Agent stream continues', async () => {
    vi.mocked(callAgentResponsesApi).mockImplementationOnce(async (opts) => {
      await opts.onImageToolStarted?.({ toolCallId: 'ig-fail' })
      await opts.onImagePartialImage?.({
        toolCallId: 'ig-fail',
        image: 'data:image/png;base64,cGFydGlhbA==',
        partialImageIndex: 0,
      })
      await opts.onImageToolFailed?.({ toolCallId: 'ig-fail', error: 'safety rejected' })
      opts.onTextDelta?.('图片失败，但回复继续。')
      return {
        text: '图片失败，但回复继续。',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '图片失败，但回复继续。' }] }],
        responseId: 'response-continued',
      }
    })

    await submitAgentMessage()
    for (let i = 0; i < 10 && useStore.getState().agentConversations[0].rounds[0]?.status !== 'done'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }

    const state = useStore.getState()
    const failedTask = state.tasks[0]
    expect(failedTask).toMatchObject({
      status: 'error',
      error: 'safety rejected',
      agentToolCallId: 'ig-fail',
      sourceMode: 'agent',
    })
    expect(state.streamPreviews[failedTask.id]).toBeUndefined()
    expect(state.streamPreviewSlots[failedTask.id]).toBeUndefined()

    const round = state.agentConversations[0].rounds[0]
    expect(round).toMatchObject({
      status: 'done',
      error: null,
      outputTaskIds: [failedTask.id],
    })
    expect(state.agentConversations[0].messages.find((message) => message.role === 'assistant')).toMatchObject({
      content: '图片失败，但回复继续。',
      outputTaskIds: [failedTask.id],
    })
  })
})

describe('agent batch reference resolution', () => {
  const responsesProfile = createDefaultOpenAIProfile({
    id: 'responses-profile',
    apiKey: 'test-key',
    apiMode: 'responses',
    model: DEFAULT_RESPONSES_MODEL,
  })

  beforeEach(async () => {
    await clearImages()
    await putImage(imageA)
    await putImage(imageB)
    vi.mocked(callAgentResponsesApi).mockClear()
    vi.mocked(callBatchImageSingle).mockClear()
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiMode: 'responses',
        model: DEFAULT_RESPONSES_MODEL,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
      }),
      prompt: '继续生成',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      appMode: 'agent',
      tasks: [
        task({ id: 'task-branch-a', outputImages: [imageA.id], sourceMode: 'agent', agentRoundId: 'round-2-a' }),
        task({ id: 'task-branch-b', outputImages: [imageB.id], sourceMode: 'agent', agentRoundId: 'round-2-b' }),
      ],
      agentConversations: [agentConversation({
        id: 'conversation-a',
        activeRoundId: 'round-2-b',
        rounds: [
          {
            id: 'round-1',
            index: 1,
            parentRoundId: null,
            userMessageId: 'user-1',
            assistantMessageId: 'assistant-1',
            prompt: '画基础图',
            inputImageIds: [],
            outputTaskIds: [],
            status: 'done',
            error: null,
            createdAt: 1,
            finishedAt: 2,
          },
          {
            id: 'round-2-a',
            index: 2,
            parentRoundId: 'round-1',
            userMessageId: 'user-2-a',
            assistantMessageId: 'assistant-2-a',
            prompt: '分支 A',
            inputImageIds: [],
            outputTaskIds: ['task-branch-a'],
            status: 'done',
            error: null,
            createdAt: 3,
            finishedAt: 4,
          },
          {
            id: 'round-2-b',
            index: 2,
            parentRoundId: 'round-1',
            userMessageId: 'user-2-b',
            assistantMessageId: 'assistant-2-b',
            prompt: '分支 B',
            inputImageIds: [],
            outputTaskIds: ['task-branch-b'],
            status: 'done',
            error: null,
            createdAt: 5,
            finishedAt: 6,
          },
        ],
        messages: [
          { id: 'user-1', role: 'user', content: '画基础图', roundId: 'round-1', createdAt: 1 },
          { id: 'assistant-1', role: 'assistant', content: '完成', roundId: 'round-1', createdAt: 2 },
          { id: 'user-2-a', role: 'user', content: '分支 A', roundId: 'round-2-a', createdAt: 3 },
          { id: 'assistant-2-a', role: 'assistant', content: '完成', roundId: 'round-2-a', outputTaskIds: ['task-branch-a'], createdAt: 4 },
          { id: 'user-2-b', role: 'user', content: '分支 B', roundId: 'round-2-b', createdAt: 5 },
          { id: 'assistant-2-b', role: 'assistant', content: '完成', roundId: 'round-2-b', outputTaskIds: ['task-branch-b'], createdAt: 6 },
        ],
      })],
      activeAgentConversationId: 'conversation-a',
      agentEditingRoundId: null,
      showToast: vi.fn(),
    })
  })

  it('resolves batch references from the active branch path only', async () => {
    vi.mocked(callAgentResponsesApi)
      .mockResolvedValueOnce({
        text: '',
        images: [],
        outputItems: [{
          type: 'function_call',
          name: 'generate_image_batch',
          call_id: 'batch-call',
          arguments: JSON.stringify({
            images: [{
              id: 'next-image',
              prompt: '参考 <ref id="round-2-image-1" /> 生成',
            }],
          }),
        }],
        responseId: 'response-1',
      })
      .mockResolvedValueOnce({
        text: '完成',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '完成' }] }],
        responseId: 'response-2',
      })

    await submitAgentMessage()

    for (let i = 0; i < 5 && vi.mocked(callBatchImageSingle).mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(callBatchImageSingle).toHaveBeenCalled()
    const batchArgs = vi.mocked(callBatchImageSingle).mock.calls[0][0]
    expect(batchArgs.referenceImageDataUrls).toEqual([imageB.dataUrl])
    expect(batchArgs.referenceImageDataUrls).not.toContain(imageA.dataUrl)
    expect(batchArgs.referenceIds).toEqual(['round-2-image-1'])
  })

  it('resolves batch references to current round input images', async () => {
    useStore.setState({ inputImages: [imageA] })
    vi.mocked(callAgentResponsesApi)
      .mockResolvedValueOnce({
        text: '',
        images: [],
        outputItems: [{
          type: 'function_call',
          name: 'generate_image_batch',
          call_id: 'batch-call',
          arguments: JSON.stringify({
            images: [{
              id: 'variant-image',
              prompt: '参考 <ref id="round-3-reference-1" /> 生成变体',
            }],
          }),
        }],
        responseId: 'response-1',
      })
      .mockResolvedValueOnce({
        text: '完成',
        images: [],
        outputItems: [{ type: 'message', content: [{ type: 'output_text', text: '完成' }] }],
        responseId: 'response-2',
      })

    await submitAgentMessage()

    for (let i = 0; i < 5 && vi.mocked(callBatchImageSingle).mock.calls.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    expect(callBatchImageSingle).toHaveBeenCalled()
    const batchArgs = vi.mocked(callBatchImageSingle).mock.calls[0][0]
    expect(batchArgs.referenceImageDataUrls).toEqual([imageA.dataUrl])
    expect(batchArgs.referenceIds).toEqual(['round-3-reference-1'])
  })
})

describe('agent assistant regeneration', () => {
  const responsesProfile = createDefaultOpenAIProfile({ id: 'openai-responses', apiKey: 'openai-key', apiMode: 'responses' })

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [responsesProfile],
        activeProfileId: responsesProfile.id,
        alwaysShowRetryButton: false,
      }),
      params: { ...DEFAULT_PARAMS, n: 4 },
      agentEditingRoundId: 'round-a',
      agentConversations: [
        agentConversation({
          id: 'conversation-a',
          activeRoundId: 'round-a',
          rounds: [{
            id: 'round-a',
            index: 1,
            parentRoundId: null,
            userMessageId: 'user-a',
            assistantMessageId: 'assistant-a',
            prompt: '画一只猫',
            inputImageIds: [imageA.id],
            outputTaskIds: [],
            status: 'done',
            error: null,
            createdAt: 1,
            finishedAt: 2,
          }],
          messages: [
            { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', inputImageIds: [imageA.id], createdAt: 1 },
            { id: 'assistant-a', role: 'assistant', content: '已完成。', roundId: 'round-a', createdAt: 2 },
          ],
        }),
      ],
      toast: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('creates a sibling round from the assistant message regardless of retry setting', async () => {
    await regenerateAgentAssistantMessage('conversation-a', 'round-a')

    const conversation = useStore.getState().agentConversations[0]
    const newRound = conversation.rounds.find((round) => round.id !== 'round-a')
    expect(newRound).toMatchObject({
      index: 1,
      parentRoundId: null,
      prompt: '画一只猫',
      inputImageIds: [imageA.id],
      status: 'running',
      outputTaskIds: [],
    })
    expect(conversation.activeRoundId).toBe(newRound?.id)
    expect(conversation.messages).toContainEqual(expect.objectContaining({
      role: 'user',
      content: '画一只猫',
      roundId: newRound?.id,
      inputImageIds: [imageA.id],
    }))
    expect(useStore.getState().agentEditingRoundId).toBeNull()
  })

  it('overwrites the same round when regenerating an error assistant message', async () => {
    useStore.setState({
      agentConversations: [
        agentConversation({
          id: 'conversation-a',
          activeRoundId: 'round-a',
          rounds: [{
            id: 'round-a',
            index: 1,
            parentRoundId: null,
            userMessageId: 'user-a',
            assistantMessageId: 'assistant-a',
            prompt: '画一只猫',
            inputImageIds: [imageA.id],
            outputTaskIds: ['task-a'],
            status: 'error',
            error: '失败',
            createdAt: 1,
            finishedAt: 2,
          }],
          messages: [
            { id: 'user-a', role: 'user', content: '画一只猫', roundId: 'round-a', inputImageIds: [imageA.id], createdAt: 1 },
            { id: 'assistant-a', role: 'assistant', content: '请求失败：失败', roundId: 'round-a', outputTaskIds: ['task-a'], createdAt: 2 },
          ],
        }),
      ],
    })

    await regenerateAgentAssistantMessage('conversation-a', 'round-a')

    const conversation = useStore.getState().agentConversations[0]
    expect(conversation.rounds).toHaveLength(1)
    expect(conversation.activeRoundId).toBe('round-a')
    expect(conversation.rounds[0]).toMatchObject({
      id: 'round-a',
      status: 'running',
      error: null,
      outputTaskIds: [],
      finishedAt: null,
    })
    expect(conversation.messages.find((message) => message.id === 'assistant-a')).toMatchObject({
      content: '',
      outputTaskIds: [],
    })
  })
})

describe('reused task API profile', () => {
  const openaiProfile = createDefaultOpenAIProfile({ id: 'openai-profile', apiKey: 'openai-key' })
  const falProfile = createDefaultFalProfile({ id: 'fal-profile', name: 'fal 配置', apiKey: 'fal-key' })

  beforeEach(() => {
    useStore.setState({
      settings: normalizeSettings({
        ...DEFAULT_SETTINGS,
        profiles: [openaiProfile, falProfile],
        activeProfileId: openaiProfile.id,
        reuseTaskApiProfileTemporarily: true,
      }),
      prompt: '',
      inputImages: [],
      maskDraft: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      showSettings: false,
      toast: null,
      reusedTaskApiProfileId: null,
      reusedTaskApiProfileName: null,
      reusedTaskApiProfileMissing: false,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('resolves a task API profile by stored profile id', () => {
    const resolved = getTaskApiProfile(useStore.getState().settings, task({ apiProvider: 'fal', apiProfileId: falProfile.id }))

    expect(resolved?.id).toBe(falProfile.id)
  })

  it('does not resolve a task API profile by stored name or model', () => {
    const resolved = getTaskApiProfile(useStore.getState().settings, task({
      apiProvider: 'fal',
      apiProfileName: falProfile.name,
      apiModel: falProfile.model,
    }))

    expect(resolved).toBeNull()
  })

  it('reuses the task API profile temporarily without switching the active profile', async () => {
    await reuseConfig(task({
      apiProvider: 'fal',
      apiProfileId: falProfile.id,
      params: { ...DEFAULT_PARAMS, n: 8, size: 'auto', quality: 'auto' },
    }))

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(openaiProfile.id)
    expect(state.reusedTaskApiProfileId).toBe(falProfile.id)
    expect(state.params).toMatchObject({ n: 4, size: '1360x1024', quality: 'high' })
    expect(state.showToast).toHaveBeenCalledWith('已临时复用该任务的 API 配置「fal 配置」', 'success')
  })

  it('keeps selected image mentions when reusing a task with different current input images', async () => {
    await clearImages()
    await putImage(imageA)
    await putImage(imageB)
    const taskPrompt = `参考 ${getSelectedImageMentionLabel(1)} 生成`

    useStore.setState({
      prompt: `当前 ${getSelectedImageMentionLabel(1)}`,
      inputImages: [
        { id: 'current-x', dataUrl: 'data:image/png;base64,x' },
        { id: 'current-y', dataUrl: 'data:image/png;base64,y' },
      ],
    })

    await reuseConfig(task({
      apiProvider: 'openai',
      apiProfileId: openaiProfile.id,
      prompt: taskPrompt,
      inputImageIds: [imageA.id, imageB.id],
    }))

    const state = useStore.getState()
    expect(state.inputImages.map((img) => img.id)).toEqual([imageA.id, imageB.id])
    expect(state.prompt).toBe(taskPrompt)
  })

  it('restores a reused mask and remaps mentions with the mask target first', async () => {
    await clearImages()
    await putImage(imageA)
    await putImage(imageB)
    await putImage({ id: 'mask-a', dataUrl: 'data:image/png;base64,mask' })

    await reuseConfig(task({
      apiProvider: 'openai',
      apiProfileId: openaiProfile.id,
      prompt: `${getSelectedImageMentionLabel(0)} 和 ${getSelectedImageMentionLabel(1)}`,
      inputImageIds: [imageA.id, imageB.id],
      maskTargetImageId: imageB.id,
      maskImageId: 'mask-a',
      params: { ...DEFAULT_PARAMS, quality: 'high' },
    }))

    const state = useStore.getState()
    expect(state.inputImages.map((img) => img.id)).toEqual([imageB.id, imageA.id])
    expect(state.prompt).toBe(`${getSelectedImageMentionLabel(1)} 和 ${getSelectedImageMentionLabel(0)}`)
    expect(state.maskDraft).toMatchObject({
      targetImageId: imageB.id,
      maskDataUrl: 'data:image/png;base64,mask',
    })
    expect(state.params.quality).toBe('high')
  })

  it('does not overwrite a draft changed while reused images are loading', async () => {
    await clearImages()
    await putImage(imageA)
    const pending = reuseConfig(task({
      apiProvider: 'fal',
      apiProfileId: falProfile.id,
      prompt: '迟到的复用草稿',
      inputImageIds: [imageA.id],
    }))

    useStore.getState().setPrompt('用户继续输入')
    await pending

    const state = useStore.getState()
    expect(state.prompt).toBe('用户继续输入')
    expect(state.inputImages).toEqual([])
    expect(state.reusedTaskApiProfileId).toBeNull()
  })

  it('only applies the latest concurrent reuse request', async () => {
    await clearImages()
    await putImage(imageA)
    await putImage(imageB)

    const first = reuseConfig(task({ apiProvider: 'openai', apiProfileId: openaiProfile.id, prompt: '复用 A', inputImageIds: [imageA.id] }))
    const second = reuseConfig(task({ apiProvider: 'openai', apiProfileId: openaiProfile.id, prompt: '复用 B', inputImageIds: [imageB.id] }))
    await Promise.all([first, second])

    const state = useStore.getState()
    expect(state.prompt).toBe('复用 B')
    expect(state.inputImages.map((img) => img.id)).toEqual([imageB.id])
  })

  it('marks missing reused image mentions instead of shifting them to another image', async () => {
    await clearImages()
    await putImage(imageB)

    await reuseConfig(task({
      apiProvider: 'openai',
      apiProfileId: openaiProfile.id,
      prompt: `${getSelectedImageMentionLabel(0)} 和 ${getSelectedImageMentionLabel(1)}`,
      inputImageIds: ['missing-image', imageB.id],
    }))

    const state = useStore.getState()
    expect(state.inputImages.map((img) => img.id)).toEqual([imageB.id])
    expect(state.prompt).toBe(`@已移除图片 和 ${getSelectedImageMentionLabel(0)}`)
  })

  it('clears temporary reuse when switching current settings to the reused API profile', async () => {
    await reuseConfig(task({ apiProvider: 'fal', apiProfileId: falProfile.id }))

    useStore.getState().setSettings({ activeProfileId: falProfile.id })

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(falProfile.id)
    expect(state.reusedTaskApiProfileId).toBeNull()
    expect(state.reusedTaskApiProfileMissing).toBe(false)
  })

  it('normalizes reused params to the current API profile when temporary reuse is disabled', async () => {
    useStore.setState({
      settings: normalizeSettings({
        ...useStore.getState().settings,
        reuseTaskApiProfileTemporarily: false,
      }),
    })

    await reuseConfig(task({
      apiProvider: 'fal',
      apiProfileId: falProfile.id,
      params: { ...DEFAULT_PARAMS, n: 8, size: 'auto', quality: 'auto' },
    }))

    const state = useStore.getState()
    expect(state.settings.activeProfileId).toBe(openaiProfile.id)
    expect(state.reusedTaskApiProfileId).toBeNull()
    expect(state.params).toMatchObject({ n: 8, size: 'auto', quality: 'auto' })
  })

  it('asks whether to submit with current API profile when the reused API profile is missing', async () => {
    await reuseConfig(task({ apiProvider: 'fal', apiProfileId: 'missing-profile' }))

    const state = useStore.getState()
    expect(state.tasks).toEqual([])
    expect(state.setConfirmDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: '找不到 API 配置',
      message: '找不到复用任务所使用的 API 配置「未知配置」，要使用当前的 API 配置「默认」提交任务吗？',
      confirmText: '使用当前配置提交',
      cancelText: '放弃提交',
    }))
    expect(state.showSettings).toBe(false)
  })
})
