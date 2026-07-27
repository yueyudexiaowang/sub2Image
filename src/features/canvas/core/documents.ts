// 画布文档的纯函数：创建、清洗、连线校验与资产引用收集。禁止依赖 react / zustand / indexedDB。
import type {
  CanvasDocument,
  CanvasEdgeRecord,
  CanvasImageNode,
  CanvasNode,
  CanvasNodeKind,
  CanvasTextNode,
  CanvasViewport,
} from '../types'

// 默认尺寸统一按 16:9 节奏，保证同屏多种节点视觉协调。
export const DEFAULT_TEXT_NODE_SIZE = { w: 256, h: 144 }
export const DEFAULT_MEDIA_NODE_SIZE = { w: 384, h: 216 }

export function createCanvasDocument(id: string, title: string): CanvasDocument {
  const now = Date.now()
  return { id, title, nodes: [], edges: [], createdAt: now, updatedAt: now }
}

export function createCanvasNode(kind: CanvasNodeKind, id: string, x: number, y: number): CanvasNode {
  const base = { id, x, y, createdAt: Date.now() }
  if (kind === 'text') return { ...base, ...DEFAULT_TEXT_NODE_SIZE, kind, text: '', fontSize: 'md' }
  if (kind === 'image') return { ...base, ...DEFAULT_MEDIA_NODE_SIZE, kind }
  return { ...base, ...DEFAULT_MEDIA_NODE_SIZE, kind }
}

/**
 * 校验连线是否合法：任意类型节点间均可连接（左入右出），
 * 仅禁止自连、重复连线和成环；生成取材时再按上游类型筛选。
 */
export function isValidCanvasConnection(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdgeRecord[],
  source: string,
  target: string,
) {
  if (!source || !target || source === target) return false
  if (!nodes.some((n) => n.id === source) || !nodes.some((n) => n.id === target)) return false
  if (edges.some((e) => e.source === source && e.target === target)) return false
  return !hasPath(edges, target, source)
}

// 沿有向边判断 from 是否可达 to，用于成环检测。
function hasPath(edges: readonly CanvasEdgeRecord[], from: string, to: string) {
  const visited = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const current = stack.pop()!
    if (current === to) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const edge of edges) {
      if (edge.source === current) stack.push(edge.target)
    }
  }
  return false
}

export function collectCanvasDocumentImageIds(ids: Set<string>, docs: readonly CanvasDocument[]) {
  for (const doc of docs) {
    for (const node of doc.nodes) {
      if (node.kind === 'image' && node.imageId) ids.add(node.imageId)
      if (node.kind === 'video' && node.posterImageId) ids.add(node.posterImageId)
    }
  }
}

export function collectCanvasDocumentVideoIds(ids: Set<string>, docs: readonly CanvasDocument[]) {
  for (const doc of docs) {
    for (const node of doc.nodes) {
      if (node.kind === 'video' && node.videoId) ids.add(node.videoId)
    }
  }
}

/** 收集节点直接上游素材：图片节点作为参考图，文本节点拼接进提示词，视频上游忽略。 */
export function collectUpstreamMaterials(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdgeRecord[],
  nodeId: string,
) {
  const upstream = edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => nodes.find((n) => n.id === edge.source))
    .filter((node): node is CanvasNode => node !== undefined)
  return {
    imageIds: upstream
      .filter((node): node is CanvasImageNode => node.kind === 'image' && !!node.imageId)
      .map((node) => node.imageId!),
    text: upstream
      .filter((node): node is CanvasTextNode => node.kind === 'text' && !!node.text.trim())
      .map((node) => node.text.trim())
      .join('\n'),
  }
}

/** 把一批图片追加为画布节点，放在现有内容右侧竖排，返回新文档。 */
export function appendImageNodesToDocument(
  doc: CanvasDocument,
  images: Array<{ nodeId: string; imageId: string; width?: number; height?: number }>,
): CanvasDocument {
  const baseX = doc.nodes.length ? Math.max(...doc.nodes.map((n) => n.x + n.w)) + 80 : 0
  const baseY = doc.nodes.length ? Math.min(...doc.nodes.map((n) => n.y)) : 0
  let offsetY = 0
  const appended: CanvasNode[] = images.map((image) => {
    const w = DEFAULT_MEDIA_NODE_SIZE.w
    const h = image.width && image.height
      ? Math.min(640, Math.max(80, Math.round((w * image.height) / image.width)))
      : DEFAULT_MEDIA_NODE_SIZE.h
    const node: CanvasNode = {
      id: image.nodeId,
      kind: 'image',
      x: baseX,
      y: baseY + offsetY,
      w,
      h,
      createdAt: Date.now(),
      imageId: image.imageId,
    }
    offsetY += h + 40
    return node
  })
  return { ...doc, nodes: [...doc.nodes, ...appended], updatedAt: Date.now() }
}

/** 画布列表页封面：取最新一个有内容的图片节点或视频封面。 */
export function getCanvasDocumentCoverImageId(doc: CanvasDocument) {
  const covers = doc.nodes
    .map((node) => {
      if (node.kind === 'image' && node.imageId) return { createdAt: node.createdAt, id: node.imageId }
      if (node.kind === 'video' && node.posterImageId) return { createdAt: node.createdAt, id: node.posterImageId }
      return null
    })
    .filter((item): item is { createdAt: number; id: string } => item !== null)
  return covers.sort((a, b) => b.createdAt - a.createdAt)[0]?.id ?? null
}

// ===== 从 IndexedDB 恢复时的清洗（外部输入防御） =====

function normalizeNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeCanvasNode(value: unknown): CanvasNode | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id) return null
  if (raw.kind !== 'text' && raw.kind !== 'image' && raw.kind !== 'video') return null
  const defaults = raw.kind === 'text' ? DEFAULT_TEXT_NODE_SIZE : DEFAULT_MEDIA_NODE_SIZE
  const base = {
    id: raw.id,
    x: normalizeNumber(raw.x, 0),
    y: normalizeNumber(raw.y, 0),
    w: normalizeNumber(raw.w, defaults.w),
    h: normalizeNumber(raw.h, defaults.h),
    createdAt: normalizeNumber(raw.createdAt, Date.now()),
  }
  if (raw.kind === 'text') {
    return {
      ...base,
      kind: 'text',
      text: typeof raw.text === 'string' ? raw.text : '',
      fontSize: raw.fontSize === 'sm' || raw.fontSize === 'lg' ? raw.fontSize : 'md',
    }
  }
  if (raw.kind === 'image') {
    return {
      ...base,
      kind: 'image',
      imageId: typeof raw.imageId === 'string' ? raw.imageId : undefined,
      taskId: typeof raw.taskId === 'string' ? raw.taskId : undefined,
      aspectLocked: raw.aspectLocked === true ? true : undefined,
    }
  }
  return {
    ...base,
    kind: 'video',
    videoId: typeof raw.videoId === 'string' ? raw.videoId : undefined,
    posterImageId: typeof raw.posterImageId === 'string' ? raw.posterImageId : undefined,
    taskId: typeof raw.taskId === 'string' ? raw.taskId : undefined,
  }
}

export function normalizeCanvasDocument(value: unknown): CanvasDocument | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id) return null

  const nodes = Array.isArray(raw.nodes)
    ? raw.nodes.map(normalizeCanvasNode).filter((node): node is CanvasNode => node !== null)
    : []
  const nodeIds = new Set(nodes.map((n) => n.id))
  const edges: CanvasEdgeRecord[] = Array.isArray(raw.edges)
    ? raw.edges.filter((edge): edge is CanvasEdgeRecord =>
        !!edge && typeof edge === 'object' &&
        typeof (edge as CanvasEdgeRecord).id === 'string' &&
        typeof (edge as CanvasEdgeRecord).source === 'string' &&
        typeof (edge as CanvasEdgeRecord).target === 'string' &&
        nodeIds.has((edge as CanvasEdgeRecord).source) &&
        nodeIds.has((edge as CanvasEdgeRecord).target),
      )
    : []

  const viewportRaw = raw.viewport as Record<string, unknown> | undefined
  const viewport: CanvasViewport | undefined = viewportRaw && typeof viewportRaw === 'object'
    ? {
        x: normalizeNumber(viewportRaw.x, 0),
        y: normalizeNumber(viewportRaw.y, 0),
        zoom: Math.min(4, Math.max(0.02, normalizeNumber(viewportRaw.zoom, 1))),
      }
    : undefined

  return {
    id: raw.id,
    title: typeof raw.title === 'string' && raw.title ? raw.title : '未命名画布',
    nodes,
    edges,
    viewport,
    createdAt: normalizeNumber(raw.createdAt, Date.now()),
    updatedAt: normalizeNumber(raw.updatedAt, Date.now()),
  }
}
