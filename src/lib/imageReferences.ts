import type { PromptProject } from '../features/promptStudio'
import type { CanvasDocument } from '../features/canvas/types'
import type { AgentConversation, TaskRecord } from '../types'
import { collectCanvasDocumentImageIds } from '../features/canvas/core/documents'
import { getAllCanvasDocuments, getAllPromptProjects } from './db'

type ImageRef = {
  id: string
}

type ImageDraft = {
  inputImages: readonly ImageRef[]
  maskDraft?: {
    targetImageId: string
  } | null
  maskEditorImageId?: string | null
}

export type ImageReferenceState = ImageDraft & {
  tasks: readonly TaskRecord[]
  agentConversations: readonly AgentConversation[]
  agentInputDrafts: Readonly<Record<string, ImageDraft>>
  galleryInputDraft: ImageDraft | null
}

function addDraftImageReferences(ids: Set<string>, draft: ImageDraft | null) {
  if (!draft) return
  for (const image of draft.inputImages) ids.add(image.id)
  if (draft.maskDraft?.targetImageId) ids.add(draft.maskDraft.targetImageId)
  if (draft.maskEditorImageId) ids.add(draft.maskEditorImageId)
}

export function addTaskImageReferences(ids: Set<string>, task: TaskRecord) {
  for (const id of task.inputImageIds || []) ids.add(id)
  if (task.maskTargetImageId) ids.add(task.maskTargetImageId)
  if (task.maskImageId) ids.add(task.maskImageId)
  for (const id of task.outputImages || []) ids.add(id)
  for (const id of task.transparentOriginalImages || []) {
    if (id) ids.add(id)
  }
  for (const id of task.streamPartialImageIds || []) ids.add(id)
}

export function addAgentImageReferences(ids: Set<string>, conversations: readonly AgentConversation[]) {
  for (const conversation of conversations) {
    for (const round of conversation.rounds) {
      for (const id of round.inputImageIds) ids.add(id)
      if (round.maskTargetImageId) ids.add(round.maskTargetImageId)
      if (round.maskImageId) ids.add(round.maskImageId)
    }
    for (const message of conversation.messages) {
      for (const id of message.inputImageIds || []) ids.add(id)
      if (message.maskTargetImageId) ids.add(message.maskTargetImageId)
      if (message.maskImageId) ids.add(message.maskImageId)
    }
  }
}

export function addPromptProjectImageReferences(ids: Set<string>, projects: readonly PromptProject[]) {
  for (const project of projects) {
    for (const asset of project.source.assets || []) ids.add(asset.id)
  }
}

export function addCanvasImageReferences(ids: Set<string>, docs: readonly CanvasDocument[]) {
  collectCanvasDocumentImageIds(ids, docs)
}

export async function collectReferencedImageIds(
  state: ImageReferenceState,
  projects?: readonly PromptProject[],
  canvasDocuments?: readonly CanvasDocument[],
) {
  const ids = new Set<string>()

  for (const task of state.tasks) addTaskImageReferences(ids, task)
  addAgentImageReferences(ids, state.agentConversations)
  for (const draft of Object.values(state.agentInputDrafts)) addDraftImageReferences(ids, draft)
  addDraftImageReferences(ids, state.galleryInputDraft)
  addDraftImageReferences(ids, state)

  const savedProjects: readonly PromptProject[] = projects
    ? projects
    : await getAllPromptProjects()
  addPromptProjectImageReferences(ids, savedProjects)

  // 画布节点引用的图片必须计入，否则启动清理会误删画布内容。
  const savedCanvasDocuments: readonly CanvasDocument[] = canvasDocuments
    ? canvasDocuments
    : await getAllCanvasDocuments()
  addCanvasImageReferences(ids, savedCanvasDocuments)
  return ids
}
