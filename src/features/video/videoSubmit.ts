import { getAgentVideoApiProfile, normalizeSettings, validateApiProfile } from '../../lib/apiProfiles'
import { storeImage } from '../../lib/db'
import { genId } from '../../lib/id'
import { DEFAULT_PARAMS, type ComposerDraft, type TaskRecord } from '../../types'
import { getVideoProvider, resolveVideoProviderId, type VideoParams, type VideoProfile } from '../../videoIntegrations'
import { useStore } from '../../state/appStore'
import { putTask } from '../tasks/taskPersistence'
import { executeVideoTask } from './videoExecution'

type SubmitVideoTaskOptions = {
  draft: ComposerDraft
  params: VideoParams
  signal?: AbortSignal
  /** 无限画布发起的任务：绑定文档与节点，供画布回填结果 */
  canvasRef?: { documentId: string; nodeId: string }
}

export async function submitVideoTask({ draft, params, signal, canvasRef }: SubmitVideoTaskOptions) {
  const state = useStore.getState()
  const settings = normalizeSettings(state.settings)
  const profile = getAgentVideoApiProfile(settings)
  if (!profile) {
    state.showToast('请先在设置 > Agent 配置中选择视频 Key 和模型', 'error')
    state.setShowSettings(true)
    return
  }
  const profileError = validateApiProfile(profile)
  if (profileError) {
    state.showToast(`请先完善视频模型配置：${profileError}`, 'error')
    state.setShowSettings(true)
    return
  }
  if (!draft.prompt.trim()) {
    state.showToast('请输入提示词', 'error')
    return
  }
  const config = settings.sub2Configs.find((item) => item.profileId === profile.id)
  const videoProvider = resolveVideoProviderId(config?.platform, profile.model)
  const videoProfile: VideoProfile = {
    id: profile.id,
    name: profile.name,
    provider: videoProvider,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    timeout: profile.timeout,
  }
  const capabilities = getVideoProvider(videoProvider).getCapabilities(videoProfile)
  if (draft.inputImages.length && !capabilities.modes.includes('image-to-video')) {
    state.showToast('当前视频模型不支持图生视频', 'error')
    return
  }
  if (draft.inputImages.length > capabilities.maxImages) {
    state.showToast(`当前视频模型最多支持 ${capabilities.maxImages} 张输入图`, 'error')
    return
  }
  for (const image of draft.inputImages) {
    await storeImage(image.dataUrl)
    signal?.throwIfAborted()
  }

  const now = Date.now()
  const tasks = Array.from({ length: params.n }, (_, idx): TaskRecord => ({
    id: genId(),
    kind: 'video',
    prompt: draft.prompt.trim(),
    params: { ...DEFAULT_PARAMS },
    videoProvider,
    videoProfileId: profile.id,
    videoProfileName: profile.name,
    videoModel: profile.model,
    videoParams: { ...params, n: 1 },
    inputImageIds: draft.inputImages.map((item) => item.id),
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: now + idx,
    finishedAt: null,
    elapsed: null,
    ...(canvasRef ? { canvasDocumentId: canvasRef.documentId, canvasNodeId: canvasRef.nodeId } : {}),
  }))
  state.setTasks([...tasks, ...state.tasks])
  await Promise.all(tasks.map((task) => putTask(task)))
  state.showToast(tasks.length > 1 ? `${tasks.length} 个视频任务已提交` : '视频任务已提交', 'success')
  await Promise.all(tasks.map((task) => executeVideoTask(task.id, signal)))
}

export async function retryVideoTask(task: TaskRecord) {
  if (task.kind !== 'video' || !task.videoParams || !task.videoProvider) return
  const state = useStore.getState()
  const profile = getAgentVideoApiProfile(state.settings)
  const profileError = profile ? validateApiProfile(profile) : '视频模型 API 配置不存在'
  if (profileError || !profile) {
    state.showToast(`请先完善视频模型配置：${profileError}`, 'error')
    state.setShowSettings(true)
    return
  }
  const settings = normalizeSettings(state.settings)
  const config = settings.sub2Configs.find((item) => item.profileId === profile.id)
  const videoProvider = resolveVideoProviderId(config?.platform, profile.model)
  const now = Date.now()
  const next: TaskRecord = {
    ...task,
    id: genId(),
    outputImages: [],
    outputVideoIds: undefined,
    videoRemoteId: undefined,
    videoPollInterval: undefined,
    videoProfileId: profile.id,
    videoProfileName: profile.name,
    videoProvider,
    videoModel: profile.model,
    rawImageUrls: undefined,
    rawResponsePayload: undefined,
    status: 'running',
    error: null,
    createdAt: now,
    finishedAt: null,
    elapsed: null,
  }
  state.setTasks([next, ...state.tasks])
  await putTask(next)
  await executeVideoTask(next.id)
}
