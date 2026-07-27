import { describe, expect, it } from 'vitest'
import type { CanvasDocument, CanvasEdgeRecord, CanvasNode } from '../types'
import {
  appendImageNodesToDocument,
  collectCanvasDocumentImageIds,
  collectCanvasDocumentVideoIds,
  collectUpstreamMaterials,
  createCanvasDocument,
  createCanvasNode,
  getCanvasDocumentCoverImageId,
  isValidCanvasConnection,
  normalizeCanvasDocument,
} from './documents'

function makeNodes(): CanvasNode[] {
  return [
    { ...createCanvasNode('text', 't1', 0, 0), kind: 'text', text: 'hi', fontSize: 'md' },
    { ...createCanvasNode('image', 'i1', 100, 0), kind: 'image', imageId: 'img-a' },
    { ...createCanvasNode('image', 'i2', 200, 0), kind: 'image' },
    { ...createCanvasNode('video', 'v1', 300, 0), kind: 'video', videoId: 'vid-a', posterImageId: 'img-poster' },
  ] as CanvasNode[]
}

describe('isValidCanvasConnection', () => {
  const nodes = makeNodes()

  it('任意类型节点间均可连接', () => {
    expect(isValidCanvasConnection(nodes, [], 't1', 'i1')).toBe(true)
    expect(isValidCanvasConnection(nodes, [], 'i1', 'v1')).toBe(true)
    expect(isValidCanvasConnection(nodes, [], 'i1', 'i2')).toBe(true)
    expect(isValidCanvasConnection(nodes, [], 'v1', 'i1')).toBe(true)
    expect(isValidCanvasConnection(nodes, [], 'i1', 't1')).toBe(true)
  })

  it('禁止自连与未知节点', () => {
    expect(isValidCanvasConnection(nodes, [], 'i1', 'i1')).toBe(false)
    expect(isValidCanvasConnection(nodes, [], 'missing', 'i1')).toBe(false)
  })

  it('禁止重复连线与成环', () => {
    const edges: CanvasEdgeRecord[] = [
      { id: 'e1', source: 'i1', target: 'i2' },
      { id: 'e2', source: 'i2', target: 'v1' },
    ]
    expect(isValidCanvasConnection(nodes, edges, 'i1', 'i2')).toBe(false)
    expect(isValidCanvasConnection(nodes, edges, 'i2', 'i1')).toBe(false)
    // i1 → v1 不成环，允许
    expect(isValidCanvasConnection(nodes, edges, 'i1', 'v1')).toBe(true)
  })
})

describe('资产引用收集', () => {
  const doc: CanvasDocument = { ...createCanvasDocument('d1', '测试'), nodes: makeNodes() }

  it('收集图片节点与视频封面的图片 id', () => {
    const ids = new Set<string>()
    collectCanvasDocumentImageIds(ids, [doc])
    expect(ids).toEqual(new Set(['img-a', 'img-poster']))
  })

  it('收集视频节点的视频 id', () => {
    const ids = new Set<string>()
    collectCanvasDocumentVideoIds(ids, [doc])
    expect(ids).toEqual(new Set(['vid-a']))
  })

  it('封面取最新一个有内容的媒体节点', () => {
    expect(getCanvasDocumentCoverImageId(doc)).toBeTruthy()
    expect(getCanvasDocumentCoverImageId({ ...doc, nodes: [] })).toBe(null)
  })
})

describe('collectUpstreamMaterials', () => {
  it('收集直接上游：图片作参考图、文本拼提示词、视频与空图片忽略', () => {
    const nodes = makeNodes()
    const edges: CanvasEdgeRecord[] = [
      { id: 'e1', source: 't1', target: 'v1' },
      { id: 'e2', source: 'i1', target: 'v1' },
      { id: 'e3', source: 'i2', target: 'v1' },
    ]
    const materials = collectUpstreamMaterials(nodes, edges, 'v1')
    expect(materials.imageIds).toEqual(['img-a'])
    expect(materials.text).toBe('hi')
  })

  it('无上游时返回空素材', () => {
    const materials = collectUpstreamMaterials(makeNodes(), [], 'i2')
    expect(materials.imageIds).toEqual([])
    expect(materials.text).toBe('')
  })
})

describe('appendImageNodesToDocument', () => {
  it('把图片追加到现有内容右侧并按宽高比推导尺寸', () => {
    const doc: CanvasDocument = { ...createCanvasDocument('d1', '画布'), nodes: makeNodes() }
    const next = appendImageNodesToDocument(doc, [
      { nodeId: 'a1', imageId: 'img-1', width: 1000, height: 500 },
      { nodeId: 'a2', imageId: 'img-2' },
    ])
    expect(next.nodes).toHaveLength(doc.nodes.length + 2)
    const [first, second] = next.nodes.slice(-2)
    const maxX = Math.max(...doc.nodes.map((n) => n.x + n.w))
    expect(first.x).toBe(maxX + 80)
    expect(first).toMatchObject({ kind: 'image', imageId: 'img-1', h: 192 })
    expect(second.y).toBeGreaterThan(first.y)
    // 原文档不被修改
    expect(doc.nodes.some((n) => n.id === 'a1')).toBe(false)
  })

  it('空画布从原点开始排列', () => {
    const next = appendImageNodesToDocument(createCanvasDocument('d2', '空'), [{ nodeId: 'a1', imageId: 'img-1' }])
    expect(next.nodes[0]).toMatchObject({ x: 0, y: 0, imageId: 'img-1' })
  })
})

describe('normalizeCanvasDocument', () => {
  it('拒绝非法输入', () => {
    expect(normalizeCanvasDocument(null)).toBe(null)
    expect(normalizeCanvasDocument({})).toBe(null)
    expect(normalizeCanvasDocument({ id: '' })).toBe(null)
  })

  it('清洗节点并丢弃指向不存在节点的边', () => {
    const doc = normalizeCanvasDocument({
      id: 'd1',
      title: '',
      nodes: [
        { id: 'a', kind: 'image', x: 1, y: 2, imageId: 'img-a' },
        { id: 'b', kind: 'unknown' },
        null,
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'a' },
        { id: 'e2', source: 'a', target: 'missing' },
      ],
      viewport: { x: 0, y: 0, zoom: 999 },
    })
    expect(doc).not.toBe(null)
    expect(doc!.title).toBe('未命名画布')
    expect(doc!.nodes).toHaveLength(1)
    expect(doc!.nodes[0]).toMatchObject({ id: 'a', kind: 'image', x: 1, y: 2, imageId: 'img-a' })
    expect(doc!.edges).toHaveLength(1)
    expect(doc!.viewport!.zoom).toBe(4)
  })

  it('保留完整文档', () => {
    const source: CanvasDocument = { ...createCanvasDocument('d2', '画布'), nodes: makeNodes(), edges: [{ id: 'e1', source: 't1', target: 'i1' }] }
    const doc = normalizeCanvasDocument(source)
    expect(doc).toEqual(source)
  })
})
