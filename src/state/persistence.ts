import type { AgentConversation, AgentMessage, AgentRound, AppSettings, ResponsesOutputItem } from '../types'
import { normalizeSettings } from '../lib/apiProfiles'
import { replaceAgentConversations } from '../lib/db'
import { isRecord } from '../lib/object'
import { createSub2PlaceholderProfile, SUB2_ONLY_VERSION } from '../lib/sub2Profiles'
import {
  ensureDefaultFavoriteCollection,
  normalizeFavoriteCollections,
  resolveDefaultFavoriteCollectionId,
} from '../features/favorites/favoriteCollections'
import {
  cleanStaleAgentInputDrafts,
  getPersistableAgentInputDrafts,
  getPersistableGalleryInputDraft,
  isEmptyAgentInputDraft,
  normalizeAgentInputDraft,
  normalizeAgentInputDrafts,
  normalizeAgentInputDraftsByKey,
} from './inputDrafts'
import type { AppState } from './types'

export const agentConversationPersistence = {
  ready: false,
  migrationPending: false,
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeAgentSkillRef(value: unknown) {
  if (!value || typeof value !== 'object') return undefined
  const skill = value as { id?: unknown; name?: unknown; version?: unknown }
  if (typeof skill.id !== 'string' || typeof skill.name !== 'string' || typeof skill.version !== 'number') return undefined
  return { id: skill.id, name: skill.name, version: skill.version }
}

function normalizeAgentRound(value: unknown, fallbackIndex: number): AgentRound | null {
  if (!value || typeof value !== 'object') return null
  const round = value as Partial<AgentRound>
  if (typeof round.id !== 'string' || !round.id) return null
  if (typeof round.userMessageId !== 'string' || !round.userMessageId) return null

  const status = round.status === 'running'
    ? 'error'
    : round.status === 'error' || round.status === 'done'
    ? round.status
    : 'done'

  return {
    id: round.id,
    index: typeof round.index === 'number' ? round.index : fallbackIndex + 1,
    parentRoundId: typeof round.parentRoundId === 'string' ? round.parentRoundId : null,
    userMessageId: round.userMessageId,
    ...(typeof round.assistantMessageId === 'string' ? { assistantMessageId: round.assistantMessageId } : {}),
    prompt: typeof round.prompt === 'string' ? round.prompt : '',
    inputImageIds: normalizeStringArray(round.inputImageIds),
    maskTargetImageId: typeof round.maskTargetImageId === 'string' ? round.maskTargetImageId : null,
    maskImageId: typeof round.maskImageId === 'string' ? round.maskImageId : null,
    outputTaskIds: normalizeStringArray(round.outputTaskIds),
    ...(normalizeAgentSkillRef(round.skill) ? { skill: normalizeAgentSkillRef(round.skill) } : {}),
    ...(typeof round.responseId === 'string' ? { responseId: round.responseId } : {}),
    ...(Array.isArray(round.responseOutput) ? { responseOutput: round.responseOutput } : {}),
    status,
    error: status === 'error'
      ? typeof round.error === 'string' ? round.error : '上次请求已中断'
      : null,
    createdAt: typeof round.createdAt === 'number' ? round.createdAt : Date.now(),
    finishedAt: typeof round.finishedAt === 'number' ? round.finishedAt : null,
  }
}

function normalizeAgentMessage(value: unknown): AgentMessage | null {
  if (!value || typeof value !== 'object') return null
  const message = value as Partial<AgentMessage>
  if (typeof message.id !== 'string' || !message.id) return null
  if (message.role !== 'user' && message.role !== 'assistant') return null
  if (typeof message.roundId !== 'string' || !message.roundId) return null

  return {
    id: message.id,
    role: message.role,
    content: typeof message.content === 'string' ? message.content : '',
    roundId: message.roundId,
    ...(Array.isArray(message.inputImageIds) ? { inputImageIds: normalizeStringArray(message.inputImageIds) } : {}),
    maskTargetImageId: typeof message.maskTargetImageId === 'string' ? message.maskTargetImageId : null,
    maskImageId: typeof message.maskImageId === 'string' ? message.maskImageId : null,
    ...(Array.isArray(message.outputTaskIds) ? { outputTaskIds: normalizeStringArray(message.outputTaskIds) } : {}),
    ...(normalizeAgentSkillRef(message.skill) ? { skill: normalizeAgentSkillRef(message.skill) } : {}),
    createdAt: typeof message.createdAt === 'number' ? message.createdAt : Date.now(),
  }
}

export function normalizeAgentConversations(value: unknown): AgentConversation[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((item): item is AgentConversation => Boolean(item) && typeof item === 'object' && typeof (item as AgentConversation).id === 'string')
    .map((conversation) => {
      const normalizedRounds = Array.isArray(conversation.rounds)
        ? conversation.rounds.map(normalizeAgentRound).filter((round): round is AgentRound => Boolean(round))
        : []
      const hasBranchParents = normalizedRounds.some((round) => round.parentRoundId)
      const hasStoredActiveRound = typeof conversation.activeRoundId === 'string'
      const rounds = hasBranchParents || hasStoredActiveRound
        ? normalizedRounds
        : normalizedRounds.map((round, index) => ({
            ...round,
            parentRoundId: index > 0 ? normalizedRounds[index - 1].id : null,
          }))
      const ids = new Set(rounds.map((round) => round.id))
      const messages = Array.isArray(conversation.messages)
        ? conversation.messages
            .map(normalizeAgentMessage)
            .filter((message): message is AgentMessage => message != null && ids.has(message.roundId))
        : []
      return {
        id: conversation.id,
        title: typeof conversation.title === 'string' && conversation.title.trim() ? conversation.title : '新对话',
        activeRoundId: typeof conversation.activeRoundId === 'string' && ids.has(conversation.activeRoundId) ? conversation.activeRoundId : rounds[rounds.length - 1]?.id ?? null,
        createdAt: typeof conversation.createdAt === 'number' ? conversation.createdAt : Date.now(),
        updatedAt: typeof conversation.updatedAt === 'number' ? conversation.updatedAt : Date.now(),
        rounds,
        messages,
      }
    })
}

export function mergeImportedAgentConversations(current: AgentConversation[], imported: AgentConversation[]) {
  const merged = [...current]
  const indexes = new Map(merged.map((conversation, index) => [conversation.id, index]))
  for (const conversation of imported) {
    const index = indexes.get(conversation.id)
    if (index == null) {
      indexes.set(conversation.id, merged.length)
      merged.push(conversation)
    } else {
      merged[index] = conversation
    }
  }
  return merged
}

export function mergeAgentConversationsForStorage(stored: AgentConversation[], legacy: AgentConversation[]) {
  const merged = new Map<string, AgentConversation>()
  for (const conversation of stored) merged.set(conversation.id, conversation)
  for (const conversation of legacy) {
    const existing = merged.get(conversation.id)
    if (!existing || conversation.updatedAt >= existing.updatedAt) merged.set(conversation.id, conversation)
  }
  return [...merged.values()].sort((a, b) => a.createdAt - b.createdAt)
}

export function getPersistableResponseOutputItem(item: ResponsesOutputItem): ResponsesOutputItem {
  if (item.type !== 'image_generation_call' || item.result == null) return item
  if (typeof item.result === 'string') {
    const { result: _result, ...rest } = item
    return rest
  }
  if (!isRecord(item.result)) return item
  const { b64_json: _b64Json, base64: _base64, image: _image, data: _data, ...result } = item.result
  if (Object.keys(result).length === 0) {
    const { result: _result, ...rest } = item
    return rest
  }
  return { ...item, result }
}

export function getPersistableAgentConversations(conversations: AgentConversation[]): AgentConversation[] {
  return conversations.map((conversation) => ({
    ...conversation,
    rounds: conversation.rounds.map((round) => round.responseOutput?.length
      ? { ...round, responseOutput: round.responseOutput.map(getPersistableResponseOutputItem) }
      : round,
    ),
  }))
}

function stripPersistedAgentConversations(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((conversation) => {
    if (!isRecord(conversation) || !Array.isArray(conversation.rounds)) return conversation
    return {
      ...conversation,
      rounds: conversation.rounds.map((round) => {
        if (!isRecord(round) || !Array.isArray(round.responseOutput)) return round
        return {
          ...round,
          responseOutput: round.responseOutput.map((item) =>
            isRecord(item) ? getPersistableResponseOutputItem(item as ResponsesOutputItem) : item,
          ),
        }
      }),
    }
  })
}

/**
 * Sub2-only 不变量校验（幂等）：settings 的 sub2OnlyVersion 不匹配时重置为 Sub2 占位配置。
 * 注意：必须在 merge（每次启动都执行）里调用，而不能只放在 persist 的 migrate 里——
 * migrate 仅在持久化 version 变化时执行一次，version 已是最新的用户永远不会走到。
 */
export function ensureSub2OnlySettings(rawSettings: unknown): Record<string, unknown> {
  const input = isRecord(rawSettings) ? rawSettings : {}
  if (Number(input.sub2OnlyVersion) === SUB2_ONLY_VERSION) return input
  const profile = createSub2PlaceholderProfile()
  return {
    ...input,
    baseUrl: profile.baseUrl,
    apiKey: '',
    model: profile.model,
    apiMode: 'images',
    apiProxy: false,
    customProviders: [],
    sub2OnlyVersion: SUB2_ONLY_VERSION,
    sub2Configs: [],
    profiles: [profile],
    activeProfileId: profile.id,
    agentApiConfigMode: 'hybrid',
    agentTextProfileId: null,
    agentImageProfileId: null,
    agentVideoProfileId: null,
  }
}

export function migratePersistedState(persistedState: unknown): unknown {
  if (!isRecord(persistedState)) return persistedState
  return {
    ...persistedState,
    settings: ensureSub2OnlySettings(persistedState.settings),
    agentConversations: stripPersistedAgentConversations(persistedState.agentConversations),
  }
}

export function getPersistedState(state: AppState) {
  const settings = normalizeSettings(state.settings)
  const galleryInputDraft = getPersistableGalleryInputDraft(state)
  return {
    settings,
    params: state.params,
    ...(settings.persistInputOnRestart && (state.appMode === 'gallery' || galleryInputDraft)
      ? {
          prompt: galleryInputDraft?.prompt ?? '',
          inputImages: galleryInputDraft?.inputImages.map((img) => ({ id: img.id, dataUrl: '' })) ?? [],
        }
      : {}),
    dismissedCodexCliPrompts: state.dismissedCodexCliPrompts,
    appMode: state.appMode,
    galleryInputDraft: settings.persistInputOnRestart && galleryInputDraft
      ? { ...galleryInputDraft, inputImages: galleryInputDraft.inputImages.map((img) => ({ id: img.id, dataUrl: '' })) }
      : null,
    ...(agentConversationPersistence.migrationPending && !agentConversationPersistence.ready
      ? { agentConversations: getPersistableAgentConversations(state.agentConversations) }
      : {}),
    activeAgentConversationId: state.activeAgentConversationId,
    agentInputDrafts: getPersistableAgentInputDrafts(state),
    agentSidebarCollapsed: state.agentSidebarCollapsed,
    agentAssetTab: state.agentAssetTab,
    agentAssetPanelCollapsed: state.agentAssetPanelCollapsed,
    favoriteCollections: state.favoriteCollections,
    defaultFavoriteCollectionId: state.defaultFavoriteCollectionId,
    supportPromptDismissed: state.supportPromptDismissed,
    supportPromptOpen: state.supportPromptOpen,
    supportPromptSkippedForImportedData: state.supportPromptSkippedForImportedData,
  }
}

export async function replaceStoredAgentConversations(conversations: AgentConversation[]) {
  await replaceAgentConversations(getPersistableAgentConversations(conversations))
}

export function mergePersistedState(persistedState: unknown, currentState: AppState): AppState {
  if (!persistedState || typeof persistedState !== 'object') return currentState

  const persisted = persistedState as Partial<AppState>
  // 每次启动都做 Sub2-only 幂等校验，避免只依赖 migrate（version 不变时不会执行）
  const settings = normalizeSettings(ensureSub2OnlySettings(persisted.settings ?? currentState.settings) as Partial<AppSettings> as AppSettings)
  const hasPersistedAgentConversations = Array.isArray(persisted.agentConversations)
  if (hasPersistedAgentConversations && normalizeAgentConversations(persisted.agentConversations).length > 0) {
    agentConversationPersistence.migrationPending = true
  }
  const agentConversations = hasPersistedAgentConversations
    ? normalizeAgentConversations(persisted.agentConversations)
    : currentState.agentConversations
  const activeAgentConversationId = typeof persisted.activeAgentConversationId === 'string'
    && (!hasPersistedAgentConversations || agentConversations.some((conversation) => conversation.id === persisted.activeAgentConversationId))
      ? persisted.activeAgentConversationId
      : agentConversations[0]?.id ?? null
  const appMode = persisted.appMode === 'agent' ? 'agent' : 'gallery'
  const galleryInputDraft = settings.persistInputOnRestart
    ? normalizeAgentInputDraft(persisted.galleryInputDraft ?? {
        prompt: persisted.prompt,
        inputImages: persisted.inputImages,
        maskDraft: null,
        maskEditorImageId: null,
      })
    : null
  const normalizedAgentInputDrafts = hasPersistedAgentConversations
    ? normalizeAgentInputDrafts(persisted.agentInputDrafts, agentConversations)
    : normalizeAgentInputDraftsByKey(persisted.agentInputDrafts)
  const cleanedDrafts = cleanStaleAgentInputDrafts(normalizedAgentInputDrafts, activeAgentConversationId)
  const agentInputDrafts = appMode === 'agent'
    && activeAgentConversationId
    && !cleanedDrafts[activeAgentConversationId]
    && settings.persistInputOnRestart
    && typeof persisted.prompt === 'string'
      ? {
          ...cleanedDrafts,
          [activeAgentConversationId]: normalizeAgentInputDraft({
            prompt: persisted.prompt,
            inputImages: persisted.inputImages,
            maskDraft: null,
            maskEditorImageId: null,
          }, Date.now()),
        }
      : cleanedDrafts
  const restoredAgentDraft = appMode === 'agent' && activeAgentConversationId
    ? agentInputDrafts[activeAgentConversationId] ?? null
    : null
  const favoriteCollections = Array.isArray(persisted.favoriteCollections)
    ? ensureDefaultFavoriteCollection(normalizeFavoriteCollections(persisted.favoriteCollections))
    : currentState.favoriteCollections
  const defaultFavoriteCollectionId = resolveDefaultFavoriteCollectionId(favoriteCollections, persisted.defaultFavoriteCollectionId)
  return {
    ...currentState,
    ...persisted,
    settings,
    appMode,
    galleryInputDraft: galleryInputDraft && !isEmptyAgentInputDraft(galleryInputDraft) ? galleryInputDraft : null,
    agentConversations,
    activeAgentConversationId,
    agentInputDrafts,
    agentSidebarCollapsed: Boolean(persisted.agentSidebarCollapsed),
    agentAssetTab: persisted.agentAssetTab === 'references' ? 'references' : 'outputs',
    agentAssetPanelCollapsed: Boolean(persisted.agentAssetPanelCollapsed),
    favoriteCollections,
    defaultFavoriteCollectionId,
    activeFavoriteCollectionId: null,
    favoritePickerTaskIds: null,
    supportPromptDismissed: Boolean(persisted.supportPromptDismissed),
    supportPromptOpen: Boolean(persisted.supportPromptOpen),
    supportPromptSkippedForImportedData: Boolean(persisted.supportPromptSkippedForImportedData),
    prompt: restoredAgentDraft ? restoredAgentDraft.prompt : galleryInputDraft?.prompt ?? '',
    inputImages: restoredAgentDraft ? restoredAgentDraft.inputImages : galleryInputDraft?.inputImages ?? [],
    maskDraft: restoredAgentDraft ? restoredAgentDraft.maskDraft : galleryInputDraft?.maskDraft ?? null,
    maskEditorImageId: restoredAgentDraft ? restoredAgentDraft.maskEditorImageId : galleryInputDraft?.maskEditorImageId ?? null,
  }
}
