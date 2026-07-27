import type { ComposerDraft, TaskRecord } from '../../types'
import { getActiveApiProfile, normalizeSettings, validateApiProfile } from '../../lib/apiProfiles'
import { validateMaskMatchesImage } from '../../lib/canvasImage'
import { storeImage } from '../../lib/db'
import { genId } from '../../lib/id'
import { orderInputImagesForMask } from '../../lib/mask'
import { getChangedParams, normalizeParamsForSettings } from '../../lib/paramCompatibility'
import { createTransparentOutputMeta, getTransparentRequestParams } from '../../lib/transparentImage'
import { composerDraftMatches, loadComposerDraft } from '../../integrations/conversation/composerDraft'
import { useStore } from '../../state/appStore'
import { clearInputDraftState, syncActiveInputDraft } from '../../state/inputDrafts'
import type { AppState } from '../../state/types'
import { cacheImage, removeCachedImage } from '../imageLibrary'
import { putTask } from './taskPersistence'
import { createSettingsForApiProfile, getReusedTaskApiProfile } from './taskProfiles'

export type SubmitTaskOptions = {
  allowFullMask?: boolean
  useCurrentApiProfileWhenReusedMissing?: boolean
  apiProfileId?: string
  signal?: AbortSignal
  draft?: ComposerDraft
  /** 无限画布发起的任务：绑定文档与节点，供画布回填结果 */
  canvasRef?: { documentId: string; nodeId: string }
}

function waitForTaskConfirmation(
  signal: AbortSignal,
  dialog: NonNullable<AppState['confirmDialog']>,
  action: () => Promise<void>,
) {
  return new Promise<void>((resolve, reject) => {
    let unsubscribe: () => void = () => undefined
    const abort = () => {
      unsubscribe()
      signal.removeEventListener('abort', abort)
      if (useStore.getState().confirmDialog === pending) useStore.setState({ confirmDialog: null })
      reject(signal.reason ?? new DOMException('请求已停止', 'AbortError'))
    }
    const cleanup = () => {
      unsubscribe()
      signal.removeEventListener('abort', abort)
    }
    const pending = {
      ...dialog,
      action: () => {
        cleanup()
        void action().then(resolve, reject)
      },
      cancelAction: () => {
        cleanup()
        resolve()
      },
    }

    unsubscribe = useStore.subscribe((state, previous) => {
      if (previous.confirmDialog !== pending || state.confirmDialog) return
      cleanup()
      resolve()
    })
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    useStore.setState({ confirmDialog: pending })
  })
}

export async function submitTask(
  options: SubmitTaskOptions,
  executeTask: (taskId: string, signal?: AbortSignal) => void | Promise<void>,
) {
  const state = useStore.getState()
  const { settings, reusedTaskApiProfileId, reusedTaskApiProfileName, reusedTaskApiProfileMissing, showToast, setConfirmDialog } = state
  const draft = options.draft ?? loadComposerDraft()
  const { prompt, inputImages, maskDraft } = draft
  const params = { ...state.params, ...draft.params }
  options.signal?.throwIfAborted()

  const normalizedSettings = normalizeSettings(settings)
  let activeProfile = options.apiProfileId
    ? normalizedSettings.profiles.find((profile) => profile.id === options.apiProfileId) ?? getActiveApiProfile(settings)
    : getActiveApiProfile(settings)
  let requestSettings = createSettingsForApiProfile(normalizedSettings, activeProfile)
  if (normalizedSettings.reuseTaskApiProfileTemporarily && (reusedTaskApiProfileId || reusedTaskApiProfileMissing)) {
    const reusedProfile = getReusedTaskApiProfile(normalizedSettings, reusedTaskApiProfileId)
    if (!reusedProfile) {
      if (options.useCurrentApiProfileWhenReusedMissing) {
        useStore.getState().setReusedTaskApiProfile(null)
      } else {
        const dialog = {
          title: '找不到 API 配置',
          message: `找不到复用任务所使用的 API 配置「${reusedTaskApiProfileName || '未知配置'}」，要使用当前的 API 配置「${activeProfile.name}」提交任务吗？`,
          confirmText: '使用当前配置提交',
          cancelText: '放弃提交',
        }
        const submitWithCurrentProfile = () => submitTask({
          allowFullMask: options.allowFullMask,
          useCurrentApiProfileWhenReusedMissing: true,
          apiProfileId: options.apiProfileId,
          signal: options.signal,
          draft,
        }, executeTask)
        if (options.signal) return waitForTaskConfirmation(options.signal, dialog, submitWithCurrentProfile)
        setConfirmDialog({ ...dialog, action: () => { void submitWithCurrentProfile() } })
        return
      }
    } else {
      activeProfile = reusedProfile
      requestSettings = createSettingsForApiProfile(normalizedSettings, reusedProfile)
    }
  }

  const profileError = validateApiProfile(activeProfile)
  if (profileError) {
    showToast(`请先完善请求 API 配置：${profileError}`, 'error')
    useStore.getState().setShowSettings(true)
    return
  }
  if (!prompt.trim()) {
    showToast('请输入提示词', 'error')
    return
  }

  let orderedInputImages = inputImages
  let maskImageId: string | null = null
  let maskTargetImageId: string | null = null

  if (maskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(inputImages, maskDraft.targetImageId)
      const coverage = await validateMaskMatchesImage(maskDraft.maskDataUrl, orderedInputImages[0].dataUrl)
      options.signal?.throwIfAborted()
      if (coverage === 'full' && !options.allowFullMask) {
        const dialog = {
          title: '确认编辑整张图片？',
          message: '当前遮罩覆盖了整张图片，提交后可能会重绘全部内容。是否继续？',
          confirmText: '继续提交',
          tone: 'warning' as const,
        }
        const submitFullMask = () => submitTask({ ...options, allowFullMask: true }, executeTask)
        if (options.signal) return waitForTaskConfirmation(options.signal, dialog, submitFullMask)
        setConfirmDialog({ ...dialog, action: () => { void submitFullMask() } })
        return
      }
      maskImageId = await storeImage(maskDraft.maskDataUrl, 'mask')
      cacheImage(maskImageId, maskDraft.maskDataUrl)
      maskTargetImageId = maskDraft.targetImageId
    } catch (err) {
      if (options.signal?.aborted) throw err
      if (!inputImages.some((img) => img.id === maskDraft.targetImageId)) useStore.getState().clearMaskDraft()
      showToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
  }

  for (const img of orderedInputImages) {
    await storeImage(img.dataUrl)
    options.signal?.throwIfAborted()
  }

  const normalizedParams = normalizeParamsForSettings(params, requestSettings, { hasInputImages: orderedInputImages.length > 0 })
  const shouldUseTransparentOutput = normalizedParams.output_format === 'png' && normalizedParams.transparent_output
  const taskParams = shouldUseTransparentOutput
    ? getTransparentRequestParams(normalizedParams)
    : { ...normalizedParams, transparent_output: false }
  const transparentMeta = taskParams.transparent_output ? createTransparentOutputMeta(prompt.trim()) : null
  const normalizedParamPatch = getChangedParams(params, taskParams)
  if (Object.keys(normalizedParamPatch).length) useStore.getState().setParams(normalizedParamPatch)

  const taskId = genId()
  const task: TaskRecord = {
    id: taskId,
    prompt: prompt.trim(),
    params: taskParams,
    apiProvider: activeProfile.provider,
    apiProfileId: activeProfile.id,
    apiProfileName: activeProfile.name,
    apiMode: activeProfile.apiMode,
    apiModel: activeProfile.model,
    inputImageIds: orderedInputImages.map((img) => img.id),
    maskTargetImageId,
    maskImageId,
    transparentOutput: transparentMeta?.transparentOutput,
    transparentPrompt: transparentMeta?.effectivePrompt,
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    elapsed: null,
    ...(options.canvasRef ? { canvasDocumentId: options.canvasRef.documentId, canvasNodeId: options.canvasRef.nodeId } : {}),
  }

  useStore.getState().setTasks([task, ...useStore.getState().tasks])
  await putTask(task)
  useStore.getState().showToast('任务已提交', 'success')

  if (settings.clearInputAfterSubmit) {
    useStore.setState((state) => {
      if (state.appMode === 'gallery') {
        if (!composerDraftMatches(state, draft)) return state
        for (const img of state.inputImages) removeCachedImage(img.id)
        return syncActiveInputDraft(state, clearInputDraftState())
      }
      if (!state.galleryInputDraft || !composerDraftMatches(state.galleryInputDraft, draft)) return state
      return { galleryInputDraft: null }
    })
  }
  useStore.getState().setReusedTaskApiProfile(null)
  await executeTask(taskId, options.signal)
}
