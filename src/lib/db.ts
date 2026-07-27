import type { PromptProject } from '../features/promptStudio'
import type { CanvasDocument } from '../features/canvas/types'
import type { AgentConversation, PromptCache, StoredImage, StoredImageThumbnail, StoredVideo, TaskRecord } from '../types'

const DB_NAME = 'gpt-image-playground'
// v8：修复 v7 升级期间可能未创建 canvasDocuments store 的问题（升级逻辑幂等，重跑安全）
const DB_VERSION = 8
const STORE_TASKS = 'tasks'
const STORE_IMAGES = 'images'
const STORE_THUMBNAILS = 'thumbnails'
const STORE_VIDEOS = 'videos'
const STORE_AGENT_CONVERSATIONS = 'agentConversations'
const STORE_PROMPT_CACHE = 'promptCache'
const STORE_PROMPT_PROJECTS = 'promptProjects'
const STORE_CANVAS_DOCUMENTS = 'canvasDocuments'
const INDEX_PROMPT_PROJECTS_CONVERSATION_ID = 'conversationId'
const THUMBNAIL_MAX_SIZE = 720
const THUMBNAIL_QUALITY = 0.9
const THUMBNAIL_VERSION = 2

export const CURRENT_THUMBNAIL_VERSION = THUMBNAIL_VERSION

let databasePromise: Promise<IDBDatabase> | null = null

function createDatabaseError(name: string, message: string) {
  const err = new Error(message)
  err.name = name
  return err
}

function getDatabaseError(error: unknown, fallback: string) {
  const value = error && typeof error === 'object'
    ? error as { name?: unknown; message?: unknown }
    : null

  if (value?.name === 'QuotaExceededError') {
    return createDatabaseError('QuotaExceededError', '存储空间不足，请清理不需要的数据后重试')
  }
  if (error instanceof Error) return error
  if (value) {
    return createDatabaseError(
      typeof value.name === 'string' && value.name ? value.name : 'Error',
      typeof value.message === 'string' && value.message ? value.message : fallback,
    )
  }
  return new Error(fallback)
}

function openDB(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise

  let settled = false
  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_TASKS)) {
        db.createObjectStore(STORE_TASKS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_THUMBNAILS)) {
        db.createObjectStore(STORE_THUMBNAILS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_VIDEOS)) {
        db.createObjectStore(STORE_VIDEOS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_AGENT_CONVERSATIONS)) {
        db.createObjectStore(STORE_AGENT_CONVERSATIONS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_PROMPT_CACHE)) {
        db.createObjectStore(STORE_PROMPT_CACHE, { keyPath: 'id' })
      }
      const projectStore = db.objectStoreNames.contains(STORE_PROMPT_PROJECTS)
        ? req.transaction!.objectStore(STORE_PROMPT_PROJECTS)
        : db.createObjectStore(STORE_PROMPT_PROJECTS, { keyPath: 'id' })
      if (!projectStore.indexNames.contains(INDEX_PROMPT_PROJECTS_CONVERSATION_ID)) {
        projectStore.createIndex(INDEX_PROMPT_PROJECTS_CONVERSATION_ID, 'conversationId')
      }
      if (!db.objectStoreNames.contains(STORE_CANVAS_DOCUMENTS)) {
        db.createObjectStore(STORE_CANVAS_DOCUMENTS, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => {
      const db = req.result
      if (settled) {
        db.close()
        return
      }
      settled = true
      db.onversionchange = () => {
        db.close()
        if (databasePromise === promise) databasePromise = null
      }
      resolve(db)
    }
    req.onerror = () => {
      if (settled) return
      settled = true
      reject(getDatabaseError(req.error, '打开本地数据库失败'))
    }
    req.onblocked = () => {
      if (settled) return
      settled = true
      reject(createDatabaseError('BlockedError', '数据库升级被其他页面阻塞，请关闭其他页面后重试'))
    }
  })

  databasePromise = promise
  void promise.catch(() => {
    if (databasePromise === promise) databasePromise = null
  })
  return promise
}

export async function closeDatabase() {
  const promise = databasePromise
  databasePromise = null
  if (!promise) return
  try {
    const db = await promise
    db.close()
  } catch {
    // 打开失败时没有可关闭的连接。
  }
}

function runTransaction<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => IDBRequest<T>,
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeNames, mode)
        let req: IDBRequest<T> | null = null
        let result: T
        let requestError: DOMException | null = null
        let settled = false

        const fail = (error: unknown, fallback: string) => {
          if (settled) return
          settled = true
          reject(getDatabaseError(error, fallback))
        }

        tx.oncomplete = () => {
          if (settled) return
          settled = true
          resolve(result)
        }
        tx.onerror = () => fail(tx.error ?? requestError, '数据库事务执行失败')
        tx.onabort = () => fail(
          tx.error ?? requestError ?? createDatabaseError('AbortError', '数据库事务已中止'),
          '数据库事务已中止',
        )

        try {
          req = fn(tx)
          req.onsuccess = () => {
            result = req!.result
          }
          req.onerror = () => {
            requestError = req?.error ?? null
          }
        } catch (err) {
          try {
            tx.abort()
          } catch {
            // 事务可能已由请求错误中止。
          }
          fail(err, '数据库事务执行失败')
        }
      }),
  )
}

function dbTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return runTransaction(storeName, mode, (tx) => fn(tx.objectStore(storeName)))
}

// ===== Tasks =====

export function getAllTasks(): Promise<TaskRecord[]> {
  return dbTransaction(STORE_TASKS, 'readonly', (s) => s.getAll())
}

export function putTask(task: TaskRecord): Promise<IDBValidKey> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.put(task))
}

export function deleteTask(id: string): Promise<undefined> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.delete(id))
}

export function clearTasks(): Promise<undefined> {
  return dbTransaction(STORE_TASKS, 'readwrite', (s) => s.clear())
}

// ===== Agent conversations =====

export function getAllAgentConversations(): Promise<AgentConversation[]> {
  return dbTransaction(STORE_AGENT_CONVERSATIONS, 'readonly', (s) => s.getAll())
}

export function putAgentConversation(conversation: AgentConversation): Promise<IDBValidKey> {
  return dbTransaction(STORE_AGENT_CONVERSATIONS, 'readwrite', (s) => s.put(conversation))
}

export function clearAgentConversations(): Promise<undefined> {
  return dbTransaction(STORE_AGENT_CONVERSATIONS, 'readwrite', (s) => s.clear())
}

export function replaceAgentConversations(conversations: AgentConversation[]): Promise<undefined> {
  return runTransaction(STORE_AGENT_CONVERSATIONS, 'readwrite', (tx) => {
    const store = tx.objectStore(STORE_AGENT_CONVERSATIONS)
    const req = store.clear()
    for (const conversation of conversations) store.put(conversation)
    return req
  })
}

// ===== Prompt cache =====

export function getAllPromptCaches(): Promise<PromptCache[]> {
  return dbTransaction(STORE_PROMPT_CACHE, 'readonly', (s) => s.getAll())
}

export function putPromptCache(cache: PromptCache): Promise<IDBValidKey> {
  return dbTransaction(STORE_PROMPT_CACHE, 'readwrite', (s) => s.put(cache))
}

// ===== Prompt projects =====

export function getAllPromptProjects(): Promise<PromptProject[]> {
  return dbTransaction(STORE_PROMPT_PROJECTS, 'readonly', (s) => s.getAll())
}

export function getPromptProject(id: string): Promise<PromptProject | null> {
  return dbTransaction<PromptProject | undefined>(STORE_PROMPT_PROJECTS, 'readonly', (s) => s.get(id))
    .then((project) => project ?? null)
}

export function getPromptProjectByConversationId(conversationId: string): Promise<PromptProject | null> {
  return dbTransaction<PromptProject[]>(STORE_PROMPT_PROJECTS, 'readonly', (s) =>
    s.index(INDEX_PROMPT_PROJECTS_CONVERSATION_ID).getAll(conversationId),
  ).then((projects) => projects.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null)
}

export function putPromptProject(project: PromptProject): Promise<IDBValidKey> {
  return dbTransaction(STORE_PROMPT_PROJECTS, 'readwrite', (s) => s.put(project))
}

export function deletePromptProject(id: string): Promise<undefined> {
  return dbTransaction(STORE_PROMPT_PROJECTS, 'readwrite', (s) => s.delete(id))
}

export function clearPromptProjects(): Promise<undefined> {
  return dbTransaction(STORE_PROMPT_PROJECTS, 'readwrite', (s) => s.clear())
}

// ===== Canvas documents =====

export function getAllCanvasDocuments(): Promise<CanvasDocument[]> {
  return dbTransaction(STORE_CANVAS_DOCUMENTS, 'readonly', (s) => s.getAll())
}

export function getCanvasDocument(id: string): Promise<CanvasDocument | null> {
  return dbTransaction<CanvasDocument | undefined>(STORE_CANVAS_DOCUMENTS, 'readonly', (s) => s.get(id))
    .then((doc) => doc ?? null)
}

export function putCanvasDocument(doc: CanvasDocument): Promise<IDBValidKey> {
  return dbTransaction(STORE_CANVAS_DOCUMENTS, 'readwrite', (s) => s.put(doc))
}

export function deleteCanvasDocument(id: string): Promise<undefined> {
  return dbTransaction(STORE_CANVAS_DOCUMENTS, 'readwrite', (s) => s.delete(id))
}

export function clearCanvasDocuments(): Promise<undefined> {
  return dbTransaction(STORE_CANVAS_DOCUMENTS, 'readwrite', (s) => s.clear())
}

// ===== Images =====

export function getImage(id: string): Promise<StoredImage | undefined> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.get(id))
}

export function getStoredImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  return dbTransaction(STORE_THUMBNAILS, 'readonly', (s) => s.get(id))
}

export async function getStoredFreshImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  const thumbnail = await getStoredImageThumbnail(id)
  return thumbnail?.thumbnailVersion === THUMBNAIL_VERSION ? thumbnail : undefined
}

export function putImageThumbnail(thumbnail: StoredImageThumbnail): Promise<IDBValidKey> {
  return dbTransaction(STORE_THUMBNAILS, 'readwrite', (s) => s.put(thumbnail))
}

export async function getImageThumbnail(id: string): Promise<StoredImageThumbnail | undefined> {
  const existingThumbnail = await getStoredImageThumbnail(id)
  if (existingThumbnail?.thumbnailVersion === THUMBNAIL_VERSION) {
    const image = await getImage(id)
    if (image && (!image.width || !image.height) && existingThumbnail.width && existingThumbnail.height) {
      await putImage({ ...image, width: existingThumbnail.width, height: existingThumbnail.height })
    }
    return existingThumbnail
  }

  const image = await getImage(id)
  if (!image) return undefined
  const legacyImage = image as StoredImage & Partial<StoredImageThumbnail>
  if (legacyImage.thumbnailDataUrl && legacyImage.thumbnailVersion === THUMBNAIL_VERSION) {
    const thumbnail: StoredImageThumbnail = {
      id,
      thumbnailDataUrl: legacyImage.thumbnailDataUrl,
      width: legacyImage.width,
      height: legacyImage.height,
      thumbnailVersion: THUMBNAIL_VERSION,
    }
    await putImageThumbnail(thumbnail)
    if ((!image.width || !image.height) && thumbnail.width && thumbnail.height) {
      await putImage({ ...image, width: thumbnail.width, height: thumbnail.height })
    }
    return thumbnail
  }

  const metadata = await safeCreateImageThumbnail(image.dataUrl)
  if (!metadata.thumbnailDataUrl) return undefined
  const thumbnail: StoredImageThumbnail = {
    id,
    thumbnailDataUrl: metadata.thumbnailDataUrl,
    width: metadata.width,
    height: metadata.height,
    thumbnailVersion: THUMBNAIL_VERSION,
  }
  await putImageThumbnail(thumbnail)
  if (metadata.width && metadata.height && (image.width !== metadata.width || image.height !== metadata.height)) {
    await putImage({ ...image, width: metadata.width, height: metadata.height })
  }
  return thumbnail
}

export function getAllImages(): Promise<StoredImage[]> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.getAll())
}

export function getAllImageIds(): Promise<string[]> {
  return dbTransaction(STORE_IMAGES, 'readonly', (s) => s.getAllKeys()).then((keys) =>
    keys.map(String),
  )
}

export function putImage(image: StoredImage): Promise<IDBValidKey> {
  return dbTransaction(STORE_IMAGES, 'readwrite', (s) => s.put(image))
}

export function deleteImage(id: string): Promise<undefined> {
  return runTransaction([STORE_IMAGES, STORE_THUMBNAILS], 'readwrite', (tx) => {
    tx.objectStore(STORE_IMAGES).delete(id)
    return tx.objectStore(STORE_THUMBNAILS).delete(id)
  })
}

export function clearImages(): Promise<undefined> {
  return runTransaction([STORE_IMAGES, STORE_THUMBNAILS], 'readwrite', (tx) => {
    tx.objectStore(STORE_IMAGES).clear()
    return tx.objectStore(STORE_THUMBNAILS).clear()
  })
}

// ===== Videos =====

export function getVideo(id: string): Promise<StoredVideo | undefined> {
  return dbTransaction(STORE_VIDEOS, 'readonly', (s) => s.get(id))
}

export function getAllVideos(): Promise<StoredVideo[]> {
  return dbTransaction(STORE_VIDEOS, 'readonly', (s) => s.getAll())
}

export function putVideo(video: StoredVideo): Promise<IDBValidKey> {
  return dbTransaction(STORE_VIDEOS, 'readwrite', (s) => s.put(video))
}

export function deleteVideo(id: string): Promise<undefined> {
  return dbTransaction(STORE_VIDEOS, 'readwrite', (s) => s.delete(id))
}

export function clearVideos(): Promise<undefined> {
  return dbTransaction(STORE_VIDEOS, 'readwrite', (s) => s.clear())
}

// ===== Image hashing & dedup =====

export async function hashDataUrl(dataUrl: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return hashDataUrlFallback(dataUrl)
  }

  const data = new TextEncoder().encode(dataUrl)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hashDataUrlFallback(dataUrl: string): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193

  for (let i = 0; i < dataUrl.length; i++) {
    const code = dataUrl.charCodeAt(i)
    h1 ^= code
    h1 = Math.imul(h1, 0x01000193)
    h2 ^= code
    h2 = Math.imul(h2, 0x27d4eb2d)
  }

  return `fallback-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

export interface StoreImageResult {
  id: string
  width?: number
  height?: number
}

/**
 * 存储图片，若已存在（按 hash 去重）则跳过。
 * 返回 image id 及图片真实宽高。
 */
export async function storeImage(dataUrl: string, source: NonNullable<StoredImage['source']> = 'upload'): Promise<string> {
  return (await storeImageWithSize(dataUrl, source)).id
}

export async function storeImageWithSize(dataUrl: string, source: NonNullable<StoredImage['source']> = 'upload'): Promise<StoreImageResult> {
  const id = await hashDataUrl(dataUrl)
  const existing = await getImage(id)
  if (!existing) {
    const thumbnail = await safeCreateImageThumbnail(dataUrl)
    await putImage({
      id,
      dataUrl,
      createdAt: Date.now(),
      source,
      width: thumbnail.width,
      height: thumbnail.height,
    })
    if (thumbnail.thumbnailDataUrl) {
      await putImageThumbnail({
        id,
        thumbnailDataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailVersion: THUMBNAIL_VERSION,
      })
    }
    return { id, width: thumbnail.width, height: thumbnail.height }
  }

  if ((await getStoredImageThumbnail(id))?.thumbnailVersion !== THUMBNAIL_VERSION) {
    const thumbnail = await safeCreateImageThumbnail(existing.dataUrl)
    const width = thumbnail.width ?? existing.width
    const height = thumbnail.height ?? existing.height
    if (thumbnail.width && thumbnail.height && (existing.width !== thumbnail.width || existing.height !== thumbnail.height)) {
      await putImage({ ...existing, width: thumbnail.width, height: thumbnail.height })
    }
    if (thumbnail.thumbnailDataUrl) {
      await putImageThumbnail({
        id,
        thumbnailDataUrl: thumbnail.thumbnailDataUrl,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailVersion: THUMBNAIL_VERSION,
      })
    }
    return { id, width, height }
  }
  return { id, width: existing.width, height: existing.height }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = dataUrl
  })
}

async function createImageThumbnail(dataUrl: string): Promise<Omit<StoredImageThumbnail, 'id'>> {
  const image = await loadImage(dataUrl)
  const width = image.naturalWidth
  const height = image.naturalHeight
  if (width <= 0 || height <= 0) throw new Error('图片尺寸无效')

  const scale = Math.min(1, THUMBNAIL_MAX_SIZE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas')
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

  return {
    thumbnailDataUrl: canvas.toDataURL('image/webp', THUMBNAIL_QUALITY),
    width,
    height,
    thumbnailVersion: THUMBNAIL_VERSION,
  }
}

async function safeCreateImageThumbnail(dataUrl: string): Promise<Partial<Omit<StoredImageThumbnail, 'id'>>> {
  try {
    return await createImageThumbnail(dataUrl)
  } catch {
    return {}
  }
}
