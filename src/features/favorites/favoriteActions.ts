import type { FavoriteCollection, TaskRecord } from '../../types'
import { genId } from '../../lib/id'
import { useStore } from '../../state/appStore'
import { putTask } from '../tasks/taskPersistence'
import {
  ALL_FAVORITES_COLLECTION_ID,
  DEFAULT_FAVORITE_COLLECTION_NAME,
  normalizeFavoriteCollectionName,
} from './favoriteCollections'
import { normalizeFavoriteCollectionIds, sameFavoriteCollectionIds } from './favoriteTaskState'

export function getTaskFavoriteCollectionIds(task: TaskRecord) {
  const ids = normalizeFavoriteCollectionIds(task.favoriteCollectionIds)
  if (ids.length > 0) return ids
  const defaultId = useStore.getState().defaultFavoriteCollectionId
  return task.isFavorite && defaultId ? [defaultId] : []
}

export function getFavoriteCollectionTitle(collectionId: string | null, collections = useStore.getState().favoriteCollections) {
  if (collectionId === ALL_FAVORITES_COLLECTION_ID) return '全部'
  return collections.find((collection) => collection.id === collectionId)?.name ?? DEFAULT_FAVORITE_COLLECTION_NAME
}

export function createFavoriteCollection(name: string) {
  const normalizedName = normalizeFavoriteCollectionName(name)
  if (!normalizedName) return null
  if (Array.from(normalizedName).length > 60) {
    useStore.getState().showToast('素材集名称最多 60 个字符', 'error')
    return null
  }
  const state = useStore.getState()
  const existing = state.favoriteCollections.find((collection) => collection.name === normalizedName)
  if (existing) return existing
  const now = Date.now()
  const collection: FavoriteCollection = { id: genId(), name: normalizedName, createdAt: now, updatedAt: now }
  state.setFavoriteCollections([...state.favoriteCollections, collection])
  state.showToast(`已创建素材集「${normalizedName}」`, 'success')
  return collection
}

export function renameFavoriteCollection(collectionId: string, name: string) {
  const normalizedName = normalizeFavoriteCollectionName(name)
  if (!normalizedName || collectionId === ALL_FAVORITES_COLLECTION_ID) return
  if (Array.from(normalizedName).length > 60) {
    useStore.getState().showToast('素材集名称最多 60 个字符', 'error')
    return
  }
  const { favoriteCollections, setFavoriteCollections, showToast } = useStore.getState()
  setFavoriteCollections(favoriteCollections.map((collection) =>
    collection.id === collectionId ? { ...collection, name: normalizedName, updatedAt: Date.now() } : collection,
  ))
  showToast('素材集名称已更新', 'success')
}

export async function updateTasksFavoriteCollections(taskIds: string[], collectionIds: string[]) {
  const ids = normalizeFavoriteCollectionIds(collectionIds)
  const uniqueTaskIds = Array.from(new Set(taskIds)).filter(Boolean)
  if (!uniqueTaskIds.length) return
  const { tasks, setTasks, clearSelection, showToast } = useStore.getState()
  const taskIdSet = new Set(uniqueTaskIds)
  const changedTaskIds = new Set<string>()
  const updated = tasks.map((task) => {
    if (!taskIdSet.has(task.id)) return task
    if (sameFavoriteCollectionIds(getTaskFavoriteCollectionIds(task), ids)) return task
    changedTaskIds.add(task.id)
    return { ...task, favoriteCollectionIds: ids, isFavorite: ids.length > 0 }
  })
  if (!changedTaskIds.size) {
    clearSelection()
    return
  }
  setTasks(updated)
  await Promise.all(updated.filter((task) => changedTaskIds.has(task.id)).map((task) => putTask(task)))
  clearSelection()
  showToast(ids.length ? '素材集已更新' : '已移出素材库', 'success')
}

export async function deleteFavoriteCollection(
  collectionId: string,
  deleteTasks: boolean,
  removeTasks: (taskIds: string[]) => Promise<void>,
) {
  if (!collectionId || collectionId === ALL_FAVORITES_COLLECTION_ID) return
  const state = useStore.getState()
  const collection = state.favoriteCollections.find((item) => item.id === collectionId)
  if (!collection || state.favoriteCollections.length <= 1) return
  const collectionTaskRefs = state.tasks
    .map((task) => ({ task, favoriteIds: getTaskFavoriteCollectionIds(task) }))
    .filter(({ favoriteIds }) => favoriteIds.includes(collectionId))
  const taskIds = collectionTaskRefs.map(({ task }) => task.id)
  const nextCollections = state.favoriteCollections.filter((item) => item.id !== collectionId)
  const nextCollectionIds = new Set(nextCollections.map((item) => item.id))
  state.setFavoriteCollections(nextCollections)
  if (state.defaultFavoriteCollectionId === collectionId) {
    const nextDefaultId = nextCollections[0]?.id
    if (nextDefaultId) useStore.getState().setDefaultFavoriteCollectionId(nextDefaultId)
  }
  if (state.activeFavoriteCollectionId === collectionId) state.setActiveFavoriteCollectionId(null)
  if (deleteTasks) {
    const idsByTaskToKeep = new Map<string, string[]>()
    const taskIdsToDelete: string[] = []
    for (const { task, favoriteIds } of collectionTaskRefs) {
      const nextIds = favoriteIds.filter((id) => id !== collectionId && nextCollectionIds.has(id))
      if (nextIds.length) idsByTaskToKeep.set(task.id, nextIds)
      else taskIdsToDelete.push(task.id)
    }
    if (idsByTaskToKeep.size) {
      const tasks = useStore.getState().tasks
      const updated = tasks.map((task) => {
        const ids = idsByTaskToKeep.get(task.id)
        return ids ? { ...task, favoriteCollectionIds: ids, isFavorite: true } : task
      })
      useStore.getState().setTasks(updated)
      await Promise.all(updated.filter((task) => idsByTaskToKeep.has(task.id)).map((task) => putTask(task)))
    }
    if (taskIdsToDelete.length) await removeTasks(taskIdsToDelete)
  } else if (taskIds.length) {
    const idsByTaskId = new Map(collectionTaskRefs.map(({ task, favoriteIds }) => [
      task.id,
      favoriteIds.filter((id) => id !== collectionId && nextCollectionIds.has(id)),
    ]))
    const updated = state.tasks.map((task) => {
      const ids = idsByTaskId.get(task.id)
      if (!ids) return task
      return { ...task, favoriteCollectionIds: ids, isFavorite: ids.length > 0 }
    })
    state.setTasks(updated)
    await Promise.all(updated.filter((task) => idsByTaskId.has(task.id)).map((task) => putTask(task)))
  }
  useStore.getState().setSelectedFavoriteCollectionIds((ids) => ids.filter((id) => id !== collectionId))
  useStore.getState().showToast(`已删除素材集「${collection.name}」`, 'success')
}
