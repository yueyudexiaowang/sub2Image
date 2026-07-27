import type { TaskRecord } from '../types'
import { collectCanvasDocumentVideoIds } from './canvas/core/documents'
import { deleteVideo, getAllCanvasDocuments } from '../lib/db'
import { useStore } from '../state/appStore'

export function addTaskVideoReferences(ids: Set<string>, task: TaskRecord) {
  for (const id of task.outputVideoIds || []) ids.add(id)
}

export async function deleteUnreferencedVideoIds(videoIds: Iterable<string>) {
  const ids = new Set(Array.from(videoIds).filter(Boolean))
  if (!ids.size) return
  const used = new Set<string>()
  for (const task of useStore.getState().tasks) addTaskVideoReferences(used, task)
  // 画布视频节点引用的视频同样不可删除。
  collectCanvasDocumentVideoIds(used, await getAllCanvasDocuments())
  for (const id of ids) {
    if (!used.has(id)) await deleteVideo(id)
  }
}
