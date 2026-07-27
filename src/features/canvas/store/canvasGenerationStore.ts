// 画布生成目标：选中空节点（文本/图片/视频）时设置，composer 的 canvas 类型据此提交生成。
import { create } from 'zustand'
import type { CanvasNodeKind } from '../types'

export type CanvasGenerationTarget = {
  documentId: string
  nodeId: string
  kind: CanvasNodeKind
  /** 直接上游图片节点的资产 id（生成参考图） */
  upstreamImageIds: string[]
  /** 直接上游文本节点内容（拼接进提示词） */
  upstreamText: string
}

type CanvasGenerationState = {
  target: CanvasGenerationTarget | null
  /** 正在生成文本的节点 id（文本生成不落任务，用此状态驱动节点 UI） */
  runningTextNodeId: string | null
  /** 文本生成结果，由画布消费后清空 */
  textResult: { nodeId: string; text: string } | null
  setTarget: (target: CanvasGenerationTarget | null) => void
  setRunningTextNodeId: (nodeId: string | null) => void
  setTextResult: (result: { nodeId: string; text: string } | null) => void
}

export const useCanvasGenerationStore = create<CanvasGenerationState>((set) => ({
  target: null,
  runningTextNodeId: null,
  textResult: null,
  setTarget: (target) => set({ target }),
  setRunningTextNodeId: (runningTextNodeId) => set({ runningTextNodeId }),
  setTextResult: (textResult) => set({ textResult }),
}))
