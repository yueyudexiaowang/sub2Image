import type { ConversationTool } from '../../features/conversationComposer'
import { useCanvasGenerationStore } from '../../features/canvas/store/canvasGenerationStore'
import { ensureImageCached } from '../../features/imageLibrary'
import { submitVideoTask } from '../../features/video'
import {
  getActiveApiProfile,
  getAgentImageApiProfile,
  getAgentTextApiProfile,
  getAgentVideoApiProfile,
  normalizeSettings,
  validateApiProfile,
} from '../../lib/apiProfiles'
import { submitTask, useStore } from '../../store'
import type { ComposerDraft, InputImage, VideoParams } from '../../types'
import { getVideoProvider, resolveVideoProviderId } from '../../videoIntegrations'
import { callAgentTextGenerationApi } from './agentApi'

export const SUB2_CANVAS_TOOL_ID = 'canvas'

type CanvasSubmitPayload = {
  draft: ComposerDraft
  videoParams: VideoParams
}

function getImageValidation() {
  const settings = normalizeSettings(useStore.getState().settings)
  const profile = settings.agentApiConfigMode === 'hybrid'
    ? getAgentImageApiProfile(settings)
    : getActiveApiProfile(settings)
  const error = profile ? validateApiProfile(profile) : '图像模型 API 配置不存在'
  return error ? `请求 API 配置不完整：${error}` : null
}

function getVideoValidation(upstreamImageCount: number) {
  const settings = normalizeSettings(useStore.getState().settings)
  const profile = getAgentVideoApiProfile(settings)
  if (!profile) return '请先在设置 > Agent 配置中选择视频 Key 和模型'
  const error = validateApiProfile(profile)
  if (error) return `视频模型配置不完整：${error}`
  if (!upstreamImageCount) return null

  const config = settings.sub2Configs.find((item) => item.profileId === profile.id)
  const providerId = resolveVideoProviderId(config?.platform, profile.model)
  const capabilities = getVideoProvider(providerId).getCapabilities({
    id: profile.id,
    name: profile.name,
    provider: providerId,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    timeout: profile.timeout,
  })
  if (!capabilities.modes.includes('image-to-video')) return '当前视频模型不支持图生视频，请切换模型或断开上游图片连线'
  if (upstreamImageCount > capabilities.maxImages) return `当前视频模型最多支持 ${capabilities.maxImages} 张参考图，请减少上游图片连线`
  return null
}

function getTextValidation() {
  const settings = normalizeSettings(useStore.getState().settings)
  const profile = getAgentTextApiProfile(settings)
  if (!profile) return '请先在设置 > Agent 配置中选择文本 Key 和模型'
  const error = validateApiProfile(profile)
  return error ? `文本模型配置不完整：${error}` : null
}

function getValidation() {
  const target = useCanvasGenerationStore.getState().target
  if (!target) return '请先在画布中选择一个节点'
  if (target.kind === 'text') return getTextValidation()
  return target.kind === 'video' ? getVideoValidation(target.upstreamImageIds.length) : getImageValidation()
}

// 组装最终 draft：上游图片作为参考图，上游文本拼接到提示词后。
async function buildCanvasDraft(base: ComposerDraft) {
  const target = useCanvasGenerationStore.getState().target
  if (!target) throw new Error('请先在画布中选择一个节点')
  const inputImages: InputImage[] = []
  for (const id of target.upstreamImageIds) {
    const dataUrl = await ensureImageCached(id)
    if (dataUrl) inputImages.push({ id, dataUrl })
  }
  const prompt = [base.prompt.trim(), target.upstreamText].filter(Boolean).join('\n')
  const draft: ComposerDraft = { prompt, inputImages, maskDraft: null, params: base.params }
  return { target, draft }
}

export const sub2CanvasTool: ConversationTool = {
  id: SUB2_CANVAS_TOOL_ID,
  label: '画布',
  getComposerState: (args) => {
    const target = useCanvasGenerationStore.getState().target
    const placeholder = target?.kind === 'video'
      ? '描述要生成的视频内容'
      : target?.kind === 'text'
      ? '描述要生成的文本内容'
      : '描述要生成的图片内容'
    return {
      placeholder,
      canSubmit: Boolean(args.input.text.trim()) && !args.running,
      validationError: getValidation(),
      running: args.running,
    }
  },
  load: async () => ({
    messageRenderers: {},
    validate: (input) => {
      if (!input.text.trim()) return '请输入提示词'
      return getValidation()
    },
    submit: async (input, _ctx, signal) => {
      const payload = input.payload as CanvasSubmitPayload | undefined
      if (!payload) throw new Error('画布任务参数缺失')
      const { target, draft } = await buildCanvasDraft(payload.draft)
      const canvasRef = { documentId: target.documentId, nodeId: target.nodeId }

      if (target.kind === 'text') {
        // 文本生成不落任务：直接调文本模型，结果经画布 store 回填节点
        const settings = normalizeSettings(useStore.getState().settings)
        const profile = getAgentTextApiProfile(settings)
        if (!profile) throw new Error('请先在设置 > Agent 配置中选择文本 Key 和模型')
        const generation = useCanvasGenerationStore.getState()
        generation.setRunningTextNodeId(target.nodeId)
        try {
          const text = await callAgentTextGenerationApi({ settings, profile, prompt: draft.prompt, signal })
          if (!text) throw new Error('模型未返回文本内容')
          useCanvasGenerationStore.getState().setTextResult({ nodeId: target.nodeId, text })
          useStore.getState().showToast('文本已生成', 'success')
        } finally {
          useCanvasGenerationStore.getState().setRunningTextNodeId(null)
        }
        return
      }

      if (target.kind === 'image') {
        const settings = normalizeSettings(useStore.getState().settings)
        const profile = settings.agentApiConfigMode === 'hybrid' ? getAgentImageApiProfile(settings) : null
        await submitTask({
          signal,
          draft,
          canvasRef,
          ...(profile ? { apiProfileId: profile.id } : {}),
        })
        return
      }
      // 画布节点一次只生成一个视频
      await submitVideoTask({ draft, params: { ...payload.videoParams, n: 1 }, signal, canvasRef })
    },
  }),
}
