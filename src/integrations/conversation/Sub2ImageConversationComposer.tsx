import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { applyComposerDraft, getActiveAgentRounds, loadComposerDraft, submitAgentDirectImage, submitAgentMessage, useStore } from '../../store'
import { agentSkills, extractAgentSkillMention, getAgentSkillMention, insertAgentSkillMention, type AgentSkill } from '../../Skills'
import { formatImageRatio } from '../../lib/size'
import { collectAgentRoundOutputImageSlots } from '../../lib/agentImageReferences'
import { getAtImageQuery, getPromptMentionParts, getSelectedImageMentionLabel, imageMentionMatches, insertImageMentionAtVisibleRange, insertTextMentionAtVisibleRange, isCursorInSelectedImageMention, restoreImageMentionMarkers, stripImageMentionMarkers } from '../../lib/promptImageMentions'
import {
  ConversationAttachments,
  ConversationComposer,
  createConversationRuntime,
  type ComposerEditorHandle,
  type ComposerEditorPart,
  type ConversationAttachmentItem,
} from '../../features/conversationComposer'
import type { PromptProject, PromptStudioToolBundle } from '../../features/promptStudio'
import GallerySelectionActionBar from '../../features/gallery/components/GallerySelectionActionBar'
import { FavoriteIcon, ImageIcon, PromptLibraryIcon, VideoIcon } from '../../components/ui/icons'
import { AiLiquidButton } from '../../components/aiLiquidButton'
import PromptLibraryModal from '../../components/PromptLibraryModal'
import { getActiveApiProfile, getAgentImageApiProfile, getAgentTextApiProfile, getAgentVideoApiProfile } from '../../lib/apiProfiles'
import { isCanvasPath } from '../../features/canvas/canvasRoutes'
import { useCanvasGenerationStore } from '../../features/canvas/store/canvasGenerationStore'
import { clearActiveComposerOwner, isComposerFocused, NEXT_COMPOSER_OWNER, setActiveComposerOwner } from './composerFocus'
import { conversationTools, SUB2_CANVAS_TOOL_ID, SUB2_CHAT_TOOL_ID, SUB2_IMAGE_TOOL_ID, SUB2_VIDEO_TOOL_ID } from './conversationTools'
import { registerSub2ImageMessageRenderers } from './conversationMessageRenderers'
import { addInputDropData, addInputImageFiles, MAX_INPUT_IMAGES, replaceInputImageFile } from './inputFiles'
import { loadSub2ImagePromptStudio } from './sub2ImagePromptTool'
import { loadSub2VideoPromptStudio } from './sub2VideoPromptTool'
import type { TaskParams, VideoParams } from '../../types'
import Sub2AssetLibraryModal from './Sub2AssetLibraryModal'
import Sub2CanvasTextComposerSettings from './Sub2CanvasTextComposerSettings'
import Sub2ImageAttachmentPreview from './Sub2ImageAttachmentPreview'
import Sub2ImageComposerSettings from './Sub2ImageComposerSettings'
import Sub2ImagePromptAgentCard from './Sub2ImagePromptAgentCard'
import Sub2VideoComposerSettings from './Sub2VideoComposerSettings'

type AtOption =
  | { key: string; label: string; type: 'input'; imageIndex: number }
  | { key: string; label: string; type: 'agent-output'; insertText: string }
  | { key: string; label: string; description: string; type: 'skill'; skill: AgentSkill }

const PROMPT_CONVERSATION_ID = 'gallery'
const VIDEO_PROMPT_CONVERSATION_ID = 'gallery-video'

function getPromptOutputSettings(params: Partial<TaskParams> = {}) {
  const sizeMatch = params.size?.match(/^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/)
  return {
    size: params.size ?? null,
    quality: params.quality ?? null,
    output_format: params.output_format ?? null,
    output_compression: params.output_compression ?? null,
    moderation: params.moderation ?? null,
    n: params.n ?? null,
    transparent_output: params.transparent_output ?? null,
    aspectRatio: sizeMatch ? formatImageRatio(Number(sizeMatch[1]), Number(sizeMatch[2])) : null,
  }
}

function getVideoPromptOutputSettings(params: VideoParams) {
  return {
    duration: params.duration,
    aspectRatio: params.aspectRatio,
    resolution: params.resolution,
    n: params.n,
  }
}

const PROMPT_OUTPUT_PARAM_KEYS = [
  'size',
  'quality',
  'output_format',
  'output_compression',
  'moderation',
  'n',
  'transparent_output',
] as const

function getPromptOutputParams(
  params: Record<string, string | number | boolean>,
  metadata: Record<string, string | number | boolean> = {},
) {
  return Object.fromEntries(PROMPT_OUTPUT_PARAM_KEYS.flatMap((key) => {
    // 设置元数据是最终提交来源，模型产物中的同名字段只能作为旧项目回退值。
    const value = metadata[`output.${key}`] ?? params[key]
    return value === undefined || value === null ? [] : [[key, value]]
  })) as Partial<TaskParams>
}

function outputSettingsKey(settings: Record<string, unknown>) {
  return JSON.stringify(Object.entries(settings)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([first], [second]) => first.localeCompare(second)))
}

function matchesPromptProjectInput(
  project: PromptProject,
  draft: ReturnType<typeof loadComposerDraft>,
  allowEmptyDraftResume: boolean,
  outputSettings: Record<string, string | number | boolean | null>,
) {
  const sourceText = draft.prompt.trim() || (draft.inputImages.length ? '请分析参考图片并确认创作需求' : '')
  if (!draft.prompt.trim() && !draft.inputImages.length) return allowEmptyDraftResume

  const storedSettings = Object.fromEntries(Object.entries(project.source.metadata ?? {})
    .filter(([key]) => key.startsWith('output.'))
    .map(([key, value]) => [key.slice('output.'.length), value]))
  if (outputSettingsKey(storedSettings) !== outputSettingsKey(outputSettings)) return false

  if ((project.source.text ?? '').trim() !== sourceText) return false

  const sourceIds = project.source.assets?.map((asset) => asset.id).join('\0') ?? ''
  const draftIds = draft.inputImages.map((image) => image.id).join('\0')
  return sourceIds === draftIds
}

export default function Sub2ImageConversationComposer() {
  const prompt = useStore((state) => state.prompt)
  const setPrompt = useStore((state) => state.setPrompt)
  const inputImages = useStore((state) => state.inputImages)
  const removeInputImage = useStore((state) => state.removeInputImage)
  const moveInputImage = useStore((state) => state.moveInputImage)
  const maskDraft = useStore((state) => state.maskDraft)
  const setMaskEditorImageId = useStore((state) => state.setMaskEditorImageId)
  const params = useStore((state) => state.params)
  const setParams = useStore((state) => state.setParams)
  const appMode = useStore((state) => state.appMode)
  const settings = useStore((state) => state.settings)
  const showToast = useStore((state) => state.showToast)
  const conversations = useStore((state) => state.agentConversations)
  const activeConversationId = useStore((state) => state.activeAgentConversationId)
  const tasks = useStore((state) => state.tasks)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)
  const replaceTargetRef = useRef<{ index: number; id: string } | null>(null)
  const dockRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<ComposerEditorHandle>(null)
  const ignoredReadyProjectRef = useRef<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [atIndex, setAtIndex] = useState(0)
  const [atDismissed, setAtDismissed] = useState(false)
  const [promptBundle, setPromptBundle] = useState<PromptStudioToolBundle | null>(null)
  const [promptOpen, setPromptOpen] = useState(false)
  const [promptAgentSelected, setPromptAgentSelected] = useState(false)
  const [generationMode, setGenerationMode] = useState<'image' | 'video'>('image')
  const [promptStarting, setPromptStarting] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showPromptLibrary, setShowPromptLibrary] = useState(false)
  const [showAssetLibrary, setShowAssetLibrary] = useState(false)
  const [showAgentWelcome, setShowAgentWelcome] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const promptDraftEditedRef = useRef(false)
  const [, refreshRuntime] = useReducer((value) => value + 1, 0)
  const runtime = useMemo(() => createConversationRuntime({
    tools: conversationTools,
    onToolLoaded: (_toolId, module) => registerSub2ImageMessageRenderers(module.messageRenderers),
  }), [])
  // 画布模式：画布页选中空图片/视频节点时，composer 以 canvas 类型工作
  const canvasTarget = useCanvasGenerationStore((state) => state.target)
  const isCanvas = canvasTarget !== null && isCanvasPath(window.location.pathname)
  const isCanvasText = isCanvas && canvasTarget.kind === 'text'
  const isVideo = isCanvas ? canvasTarget.kind === 'video' : appMode === 'gallery' && generationMode === 'video'
  // 触发按钮展示当前生效的模型名（Sub2 hybrid 模式取 agent profile，否则取激活 profile）
  const imageModelLabel = (settings.agentApiConfigMode === 'hybrid'
    ? getAgentImageApiProfile(settings)
    : getActiveApiProfile(settings))?.model || '选择模型'
  const videoModelLabel = getAgentVideoApiProfile(settings)?.model || '选择模型'
  const textModelLabel = getAgentTextApiProfile(settings)?.model || '选择模型'
  const promptConversationId = isVideo ? VIDEO_PROMPT_CONVERSATION_ID : PROMPT_CONVERSATION_ID
  const promptOutputSettings = isVideo
    ? getVideoPromptOutputSettings(settings.videoParams)
    : getPromptOutputSettings(params)
  const canvasConversationId = isCanvas ? `canvas:${canvasTarget.documentId}:${canvasTarget.nodeId}` : null
  const toolId = isCanvas ? SUB2_CANVAS_TOOL_ID : appMode === 'agent' ? SUB2_CHAT_TOOL_ID : isVideo ? SUB2_VIDEO_TOOL_ID : SUB2_IMAGE_TOOL_ID
  const conversationId = canvasConversationId ?? (appMode === 'agent' ? activeConversationId ?? 'active-agent' : promptConversationId)
  const scope = useMemo(() => ({ conversationId, toolId }), [conversationId, toolId])
  const selectedSkill = getAgentSkillMention(prompt)
  const agentSelected = promptAgentSelected || Boolean(selectedSkill)

  const changeGenerationMode = (mode: 'image' | 'video') => {
    if (promptOpen && promptBundle) promptBundle.store.pause(promptConversationId)
    setGenerationMode(mode)
    setPromptAgentSelected(false)
    setPromptOpen(false)
    setPromptBundle(null)
    setShowAgentWelcome(false)
  }

  const updateClearance = useCallback(() => {
    const dock = dockRef.current
    if (!dock) return
    const clearance = Math.max(0, window.innerHeight - dock.getBoundingClientRect().top)
    document.documentElement.style.setProperty('--composer-stack-clearance', `${Math.ceil(clearance)}px`)
  }, [])

  useLayoutEffect(() => {
    const dock = dockRef.current
    if (!dock) return
    let frame = 0
    const schedule = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(updateClearance)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(dock)
    const visualViewport = window.visualViewport
    window.addEventListener('resize', schedule)
    visualViewport?.addEventListener('resize', schedule)
    visualViewport?.addEventListener('scroll', schedule)
    schedule()
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      visualViewport?.removeEventListener('resize', schedule)
      visualViewport?.removeEventListener('scroll', schedule)
      document.documentElement.style.removeProperty('--composer-stack-clearance')
    }
  }, [promptOpen, updateClearance])

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const dock = dockRef.current
      const active = document.activeElement
      if (!dock || !(active instanceof HTMLElement) || !dock.contains(active)) return
      if (e.target instanceof Node && !dock.contains(e.target)) active.blur()
    }
    document.addEventListener('mousedown', handleMouseDown, true)
    return () => document.removeEventListener('mousedown', handleMouseDown, true)
  }, [])

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!isComposerFocused(NEXT_COMPOSER_OWNER)) return
      if (e.target instanceof Node && dockRef.current?.contains(e.target)) return
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((item) => item.type.startsWith('image/'))
        .flatMap((item) => item.getAsFile() ? [item.getAsFile()!] : [])
      if (!files.length) return
      e.preventDefault()
      promptDraftEditedRef.current = true
      void addInputImageFiles(files)
    }
    const handleDragOver = (e: DragEvent) => {
      if (!isComposerFocused(NEXT_COMPOSER_OWNER)) return
      if (e.target instanceof Node && dockRef.current?.contains(e.target)) return
      const types = Array.from(e.dataTransfer?.types ?? [])
      if (!types.some((type) => type === 'Files' || type === 'text/plain')) return
      e.preventDefault()
    }
    const handleDrop = (e: DragEvent) => {
      if (!isComposerFocused(NEXT_COMPOSER_OWNER)) return
      if (e.target instanceof Node && dockRef.current?.contains(e.target)) return
      if (!e.dataTransfer) return
      e.preventDefault()
      e.stopPropagation()
      promptDraftEditedRef.current = true
      void addInputDropData(e.dataTransfer)
    }
    document.addEventListener('paste', handlePaste)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('drop', handleDrop)
    return () => {
      document.removeEventListener('paste', handlePaste)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('drop', handleDrop)
    }
  }, [])

  useEffect(() => {
    let current = true
    runtime.loadTool(toolId)
      .then(() => {
        if (current) refreshRuntime()
      })
      .catch((err) => {
        if (current) showToast(err instanceof Error ? err.message : String(err), 'error')
      })
    return () => {
      current = false
    }
  }, [runtime, showToast, toolId])

  useEffect(() => {
    if (!promptOpen || !promptBundle) return
    const applyReady = () => {
      const snapshot = promptBundle.store.getSnapshot(promptConversationId)
      if (!snapshot.project || snapshot.project.id === ignoredReadyProjectRef.current) return
      if (snapshot.project.phase !== 'ready' || !snapshot.editor) return
      if (!isVideo) setParams(getPromptOutputParams(snapshot.editor.params, snapshot.project.source.metadata))
      setPrompt(restoreImageMentionMarkers(snapshot.editor.prompt, useStore.getState().inputImages.length))
      ignoredReadyProjectRef.current = null
      setPromptOpen(false)
      setPromptAgentSelected(false)
      showToast(`完整${isVideo ? '视频' : '图片'}提示词已写入输入框`, 'success')
    }
    applyReady()
    return promptBundle.store.subscribe(promptConversationId, applyReady)
  }, [isVideo, promptBundle, promptConversationId, promptOpen, setParams, setPrompt, showToast])

  useEffect(() => {
    if (appMode !== 'agent') return
    // 工作台模式下关闭画廊的提示词问答卡，但保留 Agent 按钮的选中状态
    if (promptOpen && promptBundle) promptBundle.store.pause(promptConversationId)
    if (promptOpen) setPromptOpen(false)
  }, [appMode, promptBundle, promptConversationId, promptOpen])

  const submitInput = useMemo(() => ({
    text: extractAgentSkillMention(prompt).text,
    attachments: inputImages.map((image, index) => ({ id: image.id, type: 'image', name: `参考图${index + 1}` })),
    params: { ...params },
  }), [appMode, inputImages, params, prompt])
  const rawComposerState = runtime.getToolComposerState({ ...scope, input: submitInput })
  // 工作台模式未选中 Agent 时走"直接生成图片"，不受 Agent 文本模型配置限制
  const composerState = appMode === 'agent' && !agentSelected
    ? { ...rawComposerState, validationError: null, placeholder: '描述你想生成的图片...' }
    : rawComposerState
  const promptProject = promptBundle?.store.getSnapshot(promptConversationId).project
  const promptAgentCanSubmit = composerState.canSubmit || Boolean(promptProject && promptProject.phase !== 'ready')
  const activeConversation = appMode === 'agent'
    ? conversations.find((item) => item.id === activeConversationId) ?? null
    : null

  const editorParts = useMemo<ComposerEditorPart[]>(() => getPromptMentionParts(prompt, inputImages).map((part) => (
    part.type === 'mention'
      ? { text: part.text, value: part.mentionText ?? getSelectedImageMentionLabel(part.imageIndex ?? 0) }
      : { text: part.text }
  )), [inputImages, prompt])
  const attachments = useMemo<ConversationAttachmentItem[]>(() => inputImages.map((image, index) => ({
    id: image.id,
    label: `参考图${index + 1}`,
    previewUrl: image.dataUrl,
    badge: image.id === maskDraft?.targetImageId ? '遮罩' : undefined,
  })), [inputImages, maskDraft?.targetImageId])
  const agentOptions = useMemo<AtOption[]>(() => {
    if (!activeConversation) return []
    return getActiveAgentRounds(activeConversation).flatMap((round) => (
      collectAgentRoundOutputImageSlots(round, tasks).flatMap((imageId, imageIndex) => {
        if (!imageId) return []
        const label = `@第${round.index}轮图${imageIndex + 1}`
        return [{ key: `agent:${round.id}:${imageIndex}:${imageId}`, label, type: 'agent-output' as const, insertText: label }]
      })
    ))
  }, [activeConversation, tasks])
  const skillOptions = !selectedSkill
    ? agentSkills.map((skill) => ({
        key: `skill:${skill.id}`,
        label: `@${skill.name}`,
        description: skill.description,
        type: 'skill' as const,
        skill,
      }))
    : []
  const atQuery = isCursorInSelectedImageMention(prompt, cursor)
    ? null
    : getAtImageQuery(stripImageMentionMarkers(prompt), cursor, { length: inputImages.length + agentOptions.length + skillOptions.length })
  const filteredSkillOptions = atQuery
    ? skillOptions.filter((option) => {
        const query = atQuery.query.trim().toLocaleLowerCase()
        const searchText = `${option.label} ${option.skill.id} ${option.description}`.toLocaleLowerCase()
        return !query || searchText.includes(query)
      })
    : []
  const atOptions: AtOption[] = atQuery
    ? [
        ...inputImages.flatMap((image, imageIndex) => imageMentionMatches(atQuery.query, imageIndex)
          ? [{ key: `input:${image.id}:${imageIndex}`, label: `@图${imageIndex + 1}`, type: 'input' as const, imageIndex }]
          : []),
        ...agentOptions.filter((option) => {
          const query = atQuery.query.trim().toLocaleLowerCase()
          const label = option.label.toLocaleLowerCase()
          return !query || label.includes(query) || label.replace(/^@/, '').includes(query)
        }),
        ...filteredSkillOptions,
      ]
    : []
  const showAtMenu = !atDismissed && Boolean(atQuery) && (atOptions.length > 0 || skillOptions.length > 0)

  const selectAtOption = (option: AtOption) => {
    if (!atQuery) return
    const next = option.type === 'input'
      ? insertImageMentionAtVisibleRange(prompt, atQuery.start, cursor, option.imageIndex)
      : option.type === 'skill'
        ? insertAgentSkillMention(prompt, atQuery.start, cursor, option.skill)
        : insertTextMentionAtVisibleRange(prompt, atQuery.start, cursor, option.insertText)
    promptDraftEditedRef.current = true
    setPrompt(next.prompt)
    if (option.type === 'skill') setPromptAgentSelected(true)
    setAtDismissed(true)
    setAtIndex(0)
    window.requestAnimationFrame(() => editorRef.current?.focus(next.cursor))
  }

  const handleEditorKeyCommand = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!showAtMenu) return false
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAtIndex((index) => (index + 1) % atOptions.length)
      return true
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAtIndex((index) => (index - 1 + atOptions.length) % atOptions.length)
      return true
    }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      e.preventDefault()
      selectAtOption(atOptions[atIndex] ?? atOptions[0])
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setAtDismissed(true)
      return true
    }
    return false
  }

  const submit = async () => {
    const draft = loadComposerDraft()
    const state = useStore.getState()
    const requestScope = {
      conversationId: canvasConversationId
        ?? (appMode === 'agent' ? state.activeAgentConversationId ?? state.createAgentConversation() : promptConversationId),
      toolId,
    }
    refreshRuntime()
    try {
      await runtime.submit({
        ...requestScope,
        input: {
          text: appMode === 'agent' ? extractAgentSkillMention(draft.prompt).text : draft.prompt,
          attachments: draft.inputImages.map((image, index) => ({ id: image.id, type: 'image', name: `参考图${index + 1}` })),
          params: { ...draft.params },
          payload: { draft, editingRoundId: state.agentEditingRoundId, videoParams: state.settings.videoParams },
        },
      })
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      refreshRuntime()
    }
  }

  // 工作台"直接生成"：不经过 Agent 分析，直接生成图片并挂到当前对话
  const submitDirect = async () => {
    const draft = loadComposerDraft()
    const state = useStore.getState()
    const targetConversationId = state.activeAgentConversationId ?? state.createAgentConversation()
    refreshRuntime()
    try {
      await submitAgentDirectImage({ draft, conversationId: targetConversationId })
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      refreshRuntime()
    }
  }

  const submitSkillFromGallery = async () => {
    const draft = loadComposerDraft()
    const state = useStore.getState()
    state.setAppMode('agent')
    applyComposerDraft(draft)
    useStore.setState({ galleryInputDraft: null })
    const nextState = useStore.getState()
    const targetConversationId = nextState.activeAgentConversationId ?? nextState.createAgentConversation()
    setPromptAgentSelected(true)
    refreshRuntime()
    try {
      await submitAgentMessage({ draft, conversationId: targetConversationId })
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) showToast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      refreshRuntime()
    }
  }

  const openPromptAgent = async () => {
    if (promptStarting) return
    setPromptStarting(true)
    try {
      const bundle = promptBundle ?? await (isVideo ? loadSub2VideoPromptStudio() : loadSub2ImagePromptStudio())
      setPromptBundle(bundle)
      await bundle.store.load(promptConversationId)
      const snapshot = bundle.store.getSnapshot(promptConversationId)
      const draft = loadComposerDraft()
      if (snapshot.project && snapshot.project.phase !== 'ready' && matchesPromptProjectInput(snapshot.project, draft, !promptDraftEditedRef.current, promptOutputSettings)) {
        const current = useStore.getState()
        if (!current.inputImages.length && snapshot.project.source.assets?.length) {
          const images = await Promise.all(snapshot.project.source.assets.map(async (asset) => ({
            id: asset.id,
            dataUrl: await bundle.store.resolveAsset(asset.id),
          })))
          current.setInputImages(images.flatMap((image) => image.dataUrl ? [{ id: image.id, dataUrl: image.dataUrl }] : []))
        } else {
          bundle.store.syncAttachments(promptConversationId, current.inputImages.map((image, index) => ({
            id: image.id,
            name: `参考图${index + 1}`,
          })))
        }
        ignoredReadyProjectRef.current = null
        promptDraftEditedRef.current = false
        setPrompt('')
        bundle.store.resume(promptConversationId)
        setPromptOpen(true)
        setPromptStarting(false)
        return
      }
      ignoredReadyProjectRef.current = snapshot.project?.id ?? null
      promptDraftEditedRef.current = false
      setPrompt('')
      setPromptOpen(true)
      const pending = bundle.store.start(promptConversationId, {
        text: draft.prompt,
        attachments: draft.inputImages.map((image, index) => ({ id: image.id, name: `参考图${index + 1}` })),
        outputSettings: promptOutputSettings,
      })
      await Promise.resolve()
      setPromptStarting(false)
      void pending.catch((err) => showToast(err instanceof Error ? err.message : String(err), 'error'))
    } catch (err) {
      setPromptOpen(false)
      setPromptAgentSelected(false)
      setPromptStarting(false)
      showToast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const togglePromptAgent = async () => {
    if (promptAgentSelected) {
      setPromptAgentSelected(false)
      setShowAgentWelcome(false)
      return
    }

    setPromptAgentSelected(true)
    setShowAgentWelcome(true)
    window.requestAnimationFrame(() => editorRef.current?.focus())
    // 工作台模式选中 Agent 走对话分析流程，无需预载画廊的提示词问答工具
    if (appMode === 'agent') return
    try {
      const bundle = promptBundle ?? await (isVideo ? loadSub2VideoPromptStudio() : loadSub2ImagePromptStudio())
      await bundle.store.load(promptConversationId)
      setPromptBundle(bundle)
    } catch (err) {
      setPromptAgentSelected(false)
      showToast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const handleFileInput = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) promptDraftEditedRef.current = true
    await addInputImageFiles(e.target.files ?? [])
    e.target.value = ''
  }
  const handleReplaceInput = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const target = replaceTargetRef.current
    e.target.value = ''
    replaceTargetRef.current = null
    if (file && target) {
      promptDraftEditedRef.current = true
      await replaceInputImageFile(target, file)
    }
  }
  const preview = previewIndex == null ? null : inputImages[previewIndex]

  return (
    <>
      {(
        <div
          ref={dockRef}
          data-conversation-composer-dock
          data-composer-owner={NEXT_COMPOSER_OWNER}
          onPointerDownCapture={() => setActiveComposerOwner(NEXT_COMPOSER_OWNER)}
          onFocusCapture={() => setActiveComposerOwner(NEXT_COMPOSER_OWNER)}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) clearActiveComposerOwner(NEXT_COMPOSER_OWNER)
          }}
          className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] left-1/2 z-30 w-full max-w-4xl -translate-x-1/2 px-3 sm:px-4"
          style={{
            left: 'calc(50% + var(--workspace-sidebar-offset, 0px))',
            maxWidth: 'min(56rem, calc(100vw - var(--workspace-sidebar-width, 0px)))',
          }}
        >
          {appMode === 'gallery' && !isCanvas && <GallerySelectionActionBar />}
          {showAgentWelcome && (
            <div
              className="cc-agent-welcome"
              role="status"
              onAnimationEnd={() => setShowAgentWelcome(false)}
            >
              <p className="cc-agent-welcome-title">欢迎使用 Agent 模式！</p>
              <p>在此模式下，Agent 会像智能助手一样，主动探索创意、多次迭代帮你生成和优化{isVideo ? '视频' : '图片'}。</p>
              <p>请描述你想要的内容，我来帮您创作！</p>
            </div>
          )}
          {promptOpen ? (
            <section className="cc-composer cc-composer--agent">
              {promptBundle && !promptStarting ? (
                <Sub2ImagePromptAgentCard
                  conversationId={promptConversationId}
                  bundle={promptBundle}
                  kind={isVideo ? 'video' : 'image'}
                  onClose={() => {
                    setPromptOpen(false)
                    setPromptAgentSelected(false)
                  }}
                  onOpenSettings={() => setShowSettings(true)}
                />
              ) : (
                <div className="flex min-h-32 items-center justify-center text-sm text-gray-500" role="status">正在启动{isVideo ? '视频' : '图片'}提示词 Agent</div>
              )}
            </section>
          ) : (
            <div className="relative">
              {showAtMenu && (
                <div data-skill-picker className="absolute bottom-full left-0 right-0 z-50 mb-3 max-h-[min(28rem,calc(100dvh-10rem))] overflow-y-auto rounded-2xl border border-gray-200/90 bg-white/95 p-2 shadow-[0_20px_60px_rgba(0,0,0,0.16)] backdrop-blur-xl dark:border-white/[0.12] dark:bg-gray-900/95">
                  <div className="flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-500 dark:text-gray-400">
                    <span>技能</span>
                    <span className="text-xs font-normal">{filteredSkillOptions.length}</span>
                  </div>
                  {atOptions.map((option, index) => (
                    <button
                      key={option.key}
                      type="button"
                      aria-label={`选择 ${option.label}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectAtOption(option)}
                      onMouseEnter={() => setAtIndex(index)}
                      className={`flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${index === atIndex ? 'bg-gray-100 text-gray-950 dark:bg-white/[0.08] dark:text-white' : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-white/[0.05]'}`}
                    >
                      <span className="shrink-0 font-medium">{option.label}</span>
                      {option.type === 'skill' && <span className="min-w-0 flex-1 truncate text-gray-400 dark:text-gray-500">{option.description}</span>}
                    </button>
                  ))}
                  {atOptions.length === 0 && (
                    <div className="px-3 py-5 text-center text-sm text-gray-500 dark:text-gray-400">没有匹配的 Skill</div>
                  )}
                </div>
              )}
              <ConversationComposer
                ownerId={NEXT_COMPOSER_OWNER}
                className={agentSelected ? 'cc-composer--agent cc-composer--agent-ready' : undefined}
                value={prompt}
                editorParts={editorParts}
                editorRef={editorRef}
                placeholder={composerState.placeholder}
                editorAriaLabel={appMode === 'agent' ? 'Agent 对话输入' : isVideo ? '视频提示词输入' : '图片提示词输入'}
                clearAriaLabel="清空输入"
                attachAriaLabel="添加图片"
                submitAriaLabel={appMode === 'agent'
                  ? '发送 Agent 消息'
                  : agentSelected ? `发送到${isVideo ? '视频' : '图片'}提示词 Agent` : isVideo ? '生成视频' : '生成图片'}
                stopAriaLabel="停止"
                enterSubmit={settings.enterSubmit}
                canSubmit={agentSelected ? promptAgentCanSubmit : composerState.canSubmit}
                submitEnabled={(agentSelected ? promptAgentCanSubmit : composerState.canSubmit) || Boolean(composerState.validationError)}
                running={composerState.running}
                attachments={(
                  <ConversationAttachments
                    items={attachments}
                    onPreview={(_id, index) => setPreviewIndex(index)}
                    onRemove={(_id, index) => {
                      promptDraftEditedRef.current = true
                      removeInputImage(index)
                    }}
                    onMove={(fromIndex, toIndex) => {
                      promptDraftEditedRef.current = true
                      moveInputImage(fromIndex, toIndex)
                    }}
                  />
                )}
                toolSlot={(<div className="flex items-center gap-1.5">{isCanvas ? null : appMode === 'gallery' ? (
                  agentSelected ? (
                      <AiLiquidButton
                        size="sm"
                        idleSpeed={0.35}
                        aria-pressed
                        className="cc-agent-button !h-8 !min-w-0 !px-4 !text-[13px]"
                        onClick={() => { void togglePromptAgent() }}
                      >
                        Agent
                      </AiLiquidButton>
                    ) : (
                      <button
                        type="button"
                        aria-pressed={false}
                        className="cc-agent-button inline-flex h-8 min-w-0 items-center rounded-full bg-gray-100 px-4 text-[13px] text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-800 dark:bg-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.14] dark:hover:text-gray-100"
                        onClick={() => { void togglePromptAgent() }}
                      >
                        Agent
                      </button>
                    )
                ) : agentSelected ? (
                    <AiLiquidButton
                      size="sm"
                      idleSpeed={0.35}
                      aria-pressed
                      className="cc-agent-button !h-8 !min-w-0 !px-4 !text-[13px]"
                      onClick={() => { void togglePromptAgent() }}
                    >
                      Agent
                    </AiLiquidButton>
                  ) : (
                    <button
                      type="button"
                      aria-pressed={false}
                      className="cc-agent-button inline-flex h-8 min-w-0 items-center rounded-full bg-gray-100 px-4 text-[13px] text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-800 dark:bg-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.14] dark:hover:text-gray-100"
                      onClick={() => { void togglePromptAgent() }}
                    >
                      Agent
                    </button>
                  )}
                  <button
                    type="button"
                    title="提示词库"
                    aria-label="提示词库"
                    className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full bg-gray-100 px-3 text-[13px] text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-800 dark:bg-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.14] dark:hover:text-gray-100"
                    onClick={() => setShowPromptLibrary(true)}
                  >
                    <PromptLibraryIcon className="h-4 w-4 shrink-0" />
                    <span className="hidden sm:inline">提示词库</span>
                  </button>
                  {!isCanvas && (
                    <button
                      type="button"
                      title="素材库"
                      aria-label="素材库"
                      className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full bg-gray-100 px-3 text-[13px] text-gray-600 transition-colors hover:bg-gray-200 hover:text-gray-800 dark:bg-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.14] dark:hover:text-gray-100"
                      onClick={() => setShowAssetLibrary(true)}
                    >
                      <FavoriteIcon className="h-4 w-4 shrink-0" />
                      <span className="hidden sm:inline">素材库</span>
                    </button>
                  )}
                </div>)}
                paramsSlot={(
                  <button
                    type="button"
                    data-composer-settings-trigger
                    className="flex h-9 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-300 dark:hover:bg-white/[0.08] dark:hover:text-gray-100 [&_svg]:h-4 [&_svg]:w-4"
                    title={isCanvasText ? '文本设置' : isVideo ? '视频设置' : '图片设置'}
                    aria-label="生成设置"
                    onClick={() => setShowSettings(true)}
                  >
                    {isCanvasText
                      ? <span data-generation-icon="text" className="text-sm font-semibold leading-none">T</span>
                      : isVideo ? <VideoIcon data-generation-icon="video" /> : <ImageIcon data-generation-icon="image" />}
                    <span className="max-w-[9.5rem] truncate">{isCanvasText ? textModelLabel : isVideo ? videoModelLabel : imageModelLabel}</span>
                  </button>
                )}
                onChange={(value) => {
                  promptDraftEditedRef.current = true
                  setPrompt(value)
                  setAtIndex(0)
                  setAtDismissed(false)
                }}
                onCursorChange={setCursor}
                onEditorKeyCommand={handleEditorKeyCommand}
                onSubmit={() => {
                  if (isCanvas) {
                    void submit()
                    return
                  }
                  if (appMode === 'gallery' && selectedSkill) {
                    void submitSkillFromGallery()
                    return
                  }
                  if (appMode === 'gallery' && agentSelected) {
                    void openPromptAgent()
                    return
                  }
                  if (isVideo) {
                    void submit()
                    return
                  }
                  if (appMode === 'agent' && !agentSelected) {
                    void submitDirect()
                    return
                  }
                  void submit()
                }}
                onStop={() => {
                  runtime.stop(scope)
                  refreshRuntime()
                }}
                onAttach={!isCanvas && inputImages.length < (isVideo ? 1 : MAX_INPUT_IMAGES) ? () => fileInputRef.current?.click() : undefined}
                onPasteFiles={(files) => {
                  // 画布模式的参考图来自节点连线，不走附件
                  if (isCanvas) return
                  promptDraftEditedRef.current = true
                  void addInputImageFiles(files)
                }}
                onDropData={(data) => {
                  if (isCanvas) return
                  promptDraftEditedRef.current = true
                  void addInputDropData(data)
                }}
                canHandleDrop={() => !isCanvas && isComposerFocused(NEXT_COMPOSER_OWNER)}
              />
            </div>
          )}
          <input ref={fileInputRef} data-new-composer-file-input type="file" accept="image/*" multiple={!isVideo} className="hidden" onChange={handleFileInput} />
          <input ref={replaceInputRef} data-new-composer-replace-input type="file" accept="image/*" className="hidden" onChange={handleReplaceInput} />
        </div>
      )}
      {showSettings && isCanvasText && <Sub2CanvasTextComposerSettings onClose={() => setShowSettings(false)} />}
      {showSettings && !isCanvasText && (isVideo ? (
          <Sub2VideoComposerSettings
            mode={isCanvas ? undefined : generationMode}
            onModeChange={isCanvas ? undefined : changeGenerationMode}
            params={settings.videoParams}
            onChange={(videoParams) => {
              useStore.getState().setSettings({ videoParams })
              promptBundle?.store.syncOutputSettings(VIDEO_PROMPT_CONVERSATION_ID, getVideoPromptOutputSettings(videoParams))
            }}
            onClose={() => setShowSettings(false)}
          />
        ) : (
          <Sub2ImageComposerSettings
            mode={appMode === 'gallery' && !isCanvas ? generationMode : undefined}
            onModeChange={appMode === 'gallery' && !isCanvas ? changeGenerationMode : undefined}
            onClose={() => setShowSettings(false)}
            onSaved={() => {
              if (!promptOpen) promptDraftEditedRef.current = true
              if (!promptBundle) return
              promptBundle.store.syncOutputSettings(PROMPT_CONVERSATION_ID, getPromptOutputSettings(useStore.getState().params))
            }}
          />
        ))}
      <Sub2AssetLibraryModal
        open={showAssetLibrary}
        onClose={() => setShowAssetLibrary(false)}
        limit={isVideo ? 1 : MAX_INPUT_IMAGES}
      />
      <PromptLibraryModal
        open={showPromptLibrary}
        onClose={() => setShowPromptLibrary(false)}
        onUse={(item) => {
          promptDraftEditedRef.current = true
          setPrompt(item.prompt)
          setShowPromptLibrary(false)
          useStore.getState().showToast('已填入提示词', 'success')
        }}
      />
      {preview && previewIndex != null && (
        <Sub2ImageAttachmentPreview
          src={preview.dataUrl}
          label={`参考图${previewIndex + 1}`}
          onClose={() => setPreviewIndex(null)}
          onMask={() => {
            setPreviewIndex(null)
            setMaskEditorImageId(preview.id)
          }}
          onReplace={() => {
            replaceTargetRef.current = { id: preview.id, index: previewIndex }
            setPreviewIndex(null)
            replaceInputRef.current?.click()
          }}
        />
      )}
    </>
  )
}
