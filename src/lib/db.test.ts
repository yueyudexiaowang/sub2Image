import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore as FakeIDBObjectStore } from 'fake-indexeddb'

import type { PromptProject } from '../features/promptStudio'
import {
  clearPromptProjects,
  closeDatabase,
  deletePromptProject,
  getAllAgentConversations,
  getAllPromptProjects,
  getAllTasks,
  getImage,
  getPromptProject,
  getPromptProjectByConversationId,
  getVideo,
  putPromptProject,
  putVideo,
} from './db'

const DB_NAME = 'gpt-image-playground'
const OLD_STORES = ['tasks', 'images', 'thumbnails', 'agentConversations', 'promptCache']
const STORE_PROMPT_PROJECTS = 'promptProjects'
const STORE_VIDEOS = 'videos'
const STORE_CANVAS_DOCUMENTS = 'canvasDocuments'

function promptProject(id: string, conversationId: string | undefined, updatedAt: number): PromptProject {
  return {
    id,
    ...(conversationId ? { conversationId } : {}),
    domain: 'image',
    title: id,
    source: { type: 'text', text: id },
    brief: { domain: 'image', fields: {} },
    messages: [],
    pendingConflicts: [],
    versions: [],
    phase: 'interview',
    schemaVersion: 1,
    createdAt: updatedAt,
    updatedAt,
  }
}

function waitForTransaction(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

function openVersion4Database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 4)
    req.onupgradeneeded = () => {
      for (const name of OLD_STORES) req.result.createObjectStore(name, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function openCurrentDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 8)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function deleteCurrentDatabase() {
  return new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('数据库删除被阻塞'))
  })
}

beforeEach(async () => {
  await closeDatabase()
  vi.stubGlobal('indexedDB', new IDBFactory())
})

afterEach(async () => {
  await closeDatabase()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('IndexedDB v8', () => {
  it('upgrades v4 without losing existing stores or records', async () => {
    const db = await openVersion4Database()
    const tx = db.transaction(['tasks', 'images', 'agentConversations'], 'readwrite')
    tx.objectStore('tasks').put({ id: 'task-v4', prompt: 'old task' })
    tx.objectStore('images').put({ id: 'image-v4', dataUrl: 'data:image/png;base64,old' })
    tx.objectStore('agentConversations').put({ id: 'conversation-v4', title: 'old conversation' })
    await waitForTransaction(tx)
    db.close()

    expect(await getAllTasks()).toContainEqual({ id: 'task-v4', prompt: 'old task' })
    expect(await getImage('image-v4')).toEqual({ id: 'image-v4', dataUrl: 'data:image/png;base64,old' })
    expect(await getAllAgentConversations()).toContainEqual({ id: 'conversation-v4', title: 'old conversation' })
    expect(await getAllPromptProjects()).toEqual([])

    await closeDatabase()
    const upgraded = await openCurrentDatabase()
    expect(upgraded.version).toBe(8)
    expect(Array.from(upgraded.objectStoreNames)).toEqual(expect.arrayContaining([...OLD_STORES, STORE_PROMPT_PROJECTS, STORE_VIDEOS, STORE_CANVAS_DOCUMENTS]))
    const projectTx = upgraded.transaction(STORE_PROMPT_PROJECTS, 'readonly')
    expect(projectTx.objectStore(STORE_PROMPT_PROJECTS).indexNames.contains('conversationId')).toBe(true)
    await waitForTransaction(projectTx)
    upgraded.close()
  })

  it('stores video blobs', async () => {
    const video = {
      id: 'video-1',
      blob: new Blob(['video'], { type: 'video/mp4' }),
      name: 'result.mp4',
      mimeType: 'video/mp4',
      duration: 3,
      width: 1280,
      height: 720,
      createdAt: 10,
    }

    await putVideo(video)
    const stored = await getVideo(video.id)
    expect(stored).toMatchObject({ ...video, blob: expect.any(Blob) })
    expect(await stored!.blob.text()).toBe('video')
  })

  it('supports project CRUD and returns the latest project for a conversation', async () => {
    const first = promptProject('project-a', 'conversation-a', 10)
    const latest = promptProject('project-b', 'conversation-a', 20)
    const other = promptProject('project-c', 'conversation-b', 30)

    await putPromptProject(first)
    await putPromptProject(latest)
    await putPromptProject(other)

    expect(await getPromptProject(first.id)).toEqual(first)
    expect(await getPromptProject('missing')).toBeNull()
    expect((await getAllPromptProjects()).map((project) => project.id).sort()).toEqual([
      'project-a',
      'project-b',
      'project-c',
    ])
    expect(await getPromptProjectByConversationId('conversation-a')).toEqual(latest)
    expect(await getPromptProjectByConversationId('missing')).toBeNull()

    const updated = { ...first, updatedAt: 40 }
    await putPromptProject(updated)
    expect(await getPromptProjectByConversationId('conversation-a')).toEqual(updated)

    await deletePromptProject(latest.id)
    expect(await getPromptProject(latest.id)).toBeNull()
    await clearPromptProjects()
    expect(await getAllPromptProjects()).toEqual([])
  })

  it('rejects when a request succeeds but its transaction aborts', async () => {
    await getAllPromptProjects()
    const originalPut = FakeIDBObjectStore.prototype.put
    const spy = vi.spyOn(FakeIDBObjectStore.prototype, 'put').mockImplementation(function (
      this: InstanceType<typeof FakeIDBObjectStore>,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const req = key === undefined
        ? originalPut.call(this, value)
        : originalPut.call(this, value, key)
      req.addEventListener('success', () => this.transaction.abort())
      return req
    })

    const project = promptProject('aborted-project', 'conversation-a', 10)
    await expect(putPromptProject(project)).rejects.toMatchObject({ name: 'AbortError' })
    spy.mockRestore()
    expect(await getPromptProject(project.id)).toBeNull()
  })

  it('keeps the QuotaExceededError name and provides a clear message', async () => {
    await getAllPromptProjects()
    const err = new Error('disk full')
    err.name = 'QuotaExceededError'
    vi.spyOn(FakeIDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw err
    })

    await expect(putPromptProject(promptProject('quota-project', 'conversation-a', 10))).rejects.toMatchObject({
      name: 'QuotaExceededError',
      message: '存储空间不足，请清理不需要的数据后重试',
    })
  })

  it('rejects a blocked v4 to v5 upgrade explicitly', async () => {
    const oldConnection = await openVersion4Database()

    await expect(getAllPromptProjects()).rejects.toMatchObject({
      name: 'BlockedError',
      message: '数据库升级被其他页面阻塞，请关闭其他页面后重试',
    })

    oldConnection.close()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('closes and resets the cached connection on versionchange', async () => {
    await putPromptProject(promptProject('project-before-delete', 'conversation-a', 10))

    await deleteCurrentDatabase()

    expect(await getAllPromptProjects()).toEqual([])
    await putPromptProject(promptProject('project-after-delete', 'conversation-a', 20))
    expect(await getPromptProject('project-after-delete')).not.toBeNull()
  })
})
