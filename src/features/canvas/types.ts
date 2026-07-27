// 无限画布的文档与节点结构。节点只保存资产 id 引用，不内嵌 dataUrl。

export type CanvasNodeBase = {
  id: string
  x: number
  y: number
  w: number
  h: number
  createdAt: number
}

export type CanvasTextNode = CanvasNodeBase & {
  kind: 'text'
  text: string
  fontSize: 'sm' | 'md' | 'lg'
}

export type CanvasImageNode = CanvasNodeBase & {
  kind: 'image'
  imageId?: string
  taskId?: string
  aspectLocked?: boolean
}

export type CanvasVideoNode = CanvasNodeBase & {
  kind: 'video'
  videoId?: string
  posterImageId?: string
  taskId?: string
}

export type CanvasNode = CanvasTextNode | CanvasImageNode | CanvasVideoNode

export type CanvasNodeKind = CanvasNode['kind']

export type CanvasEdgeRecord = {
  id: string
  source: string
  target: string
}

export type CanvasViewport = {
  x: number
  y: number
  zoom: number
}

export type CanvasDocument = {
  id: string
  title: string
  nodes: CanvasNode[]
  edges: CanvasEdgeRecord[]
  viewport?: CanvasViewport
  createdAt: number
  updatedAt: number
}
