// "加入画布"选择器的全局状态：画廊/对话入口打开，选择目标画布后写入图片节点。
import { create } from 'zustand'

type CanvasPickerState = {
  pendingImageIds: string[] | null
  openCanvasPicker: (imageIds: string[]) => void
  closeCanvasPicker: () => void
}

export const useCanvasPickerStore = create<CanvasPickerState>((set) => ({
  pendingImageIds: null,
  openCanvasPicker: (imageIds) => set({ pendingImageIds: imageIds.filter(Boolean) }),
  closeCanvasPicker: () => set({ pendingImageIds: null }),
}))

export function openCanvasPicker(imageIds: string[]) {
  useCanvasPickerStore.getState().openCanvasPicker(imageIds)
}
