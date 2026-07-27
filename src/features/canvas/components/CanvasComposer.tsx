import { useEffect, useRef } from 'react'
import Sub2ImageConversationComposer from '../../../integrations/conversation/Sub2ImageConversationComposer'
import { useStore } from '../../../state/appStore'
import { useCanvasGenerationStore } from '../store/canvasGenerationStore'

/**
 * 画布页的 composer 宿主：选中可生成节点时挂载全局聊天输入框（canvas 类型），
 * 挂载期间暂存画廊输入草稿，离开时恢复，避免画布输入覆盖画廊草稿。
 */
export default function CanvasComposer() {
  const target = useCanvasGenerationStore((state) => state.target)
  const stashRef = useRef<string | null>(null)

  useEffect(() => {
    if (target && stashRef.current === null) {
      stashRef.current = useStore.getState().prompt
      useStore.getState().setPrompt('')
    }
    if (!target && stashRef.current !== null) {
      useStore.getState().setPrompt(stashRef.current)
      stashRef.current = null
    }
  }, [target])

  useEffect(() => () => {
    if (stashRef.current !== null) {
      useStore.getState().setPrompt(stashRef.current)
      stashRef.current = null
    }
  }, [])

  if (!target) return null
  return <Sub2ImageConversationComposer />
}
