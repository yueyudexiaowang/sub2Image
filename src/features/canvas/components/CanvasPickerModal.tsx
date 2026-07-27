import { useEffect, useState } from 'react'
import { CanvasNodesIcon, CloseIcon, PlusIcon } from '../../../components/ui/icons'
import { getAllCanvasDocuments, getCanvasDocument, getImage, putCanvasDocument } from '../../../lib/db'
import { genId } from '../../../lib/id'
import { useStore } from '../../../state/appStore'
import {
  appendImageNodesToDocument,
  createCanvasDocument,
  normalizeCanvasDocument,
} from '../core/documents'
import type { CanvasDocument } from '../types'
import { navigateToCanvas } from '../canvasRoutes'
import { useCanvasPickerStore } from '../store/canvasPickerStore'

const LAST_CANVAS_KEY = 'canvas-picker-last-doc'

export default function CanvasPickerModal() {
  const pendingImageIds = useCanvasPickerStore((s) => s.pendingImageIds)
  const closeCanvasPicker = useCanvasPickerStore((s) => s.closeCanvasPicker)
  const showToast = useStore((s) => s.showToast)
  const [docs, setDocs] = useState<CanvasDocument[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!pendingImageIds) return
    let active = true
    void getAllCanvasDocuments().then((items) => {
      if (!active) return
      const lastId = localStorage.getItem(LAST_CANVAS_KEY)
      const normalized = items
        .map(normalizeCanvasDocument)
        .filter((doc): doc is CanvasDocument => doc !== null)
        .sort((a, b) => (a.id === lastId ? -1 : b.id === lastId ? 1 : b.updatedAt - a.updatedAt))
      setDocs(normalized)
    }).catch((err) => {
      console.warn('加载画布列表失败：', err)
    })
    return () => {
      active = false
    }
  }, [pendingImageIds])

  useEffect(() => {
    if (!pendingImageIds) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCanvasPicker()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeCanvasPicker, pendingImageIds])

  if (!pendingImageIds) return null

  const addTo = async (docId: string | null) => {
    setBusy(true)
    try {
      const base = docId
        ? normalizeCanvasDocument(await getCanvasDocument(docId))
        : createCanvasDocument(genId(), `无限画布 ${docs.length + 1}`)
      if (!base) throw new Error('画布不存在或已被删除')

      const images = await Promise.all(pendingImageIds.map(async (imageId) => {
        const image = await getImage(imageId)
        return { nodeId: genId(), imageId, width: image?.width, height: image?.height }
      }))
      const next = appendImageNodesToDocument(base, images)
      await putCanvasDocument(next)
      localStorage.setItem(LAST_CANVAS_KEY, next.id)
      closeCanvasPicker()
      showToast(`已加入「${next.title}」`, 'success')
      navigateToCanvas(next.id)
    } catch (err) {
      console.error('加入画布失败：', err)
      showToast(`加入画布失败：${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={closeCanvasPicker}>
      <div
        className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-[#151517]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-950 dark:text-white">
            <CanvasNodesIcon className="h-5 w-5" />
            加入画布
          </h3>
          <button
            type="button"
            onClick={closeCanvasPicker}
            aria-label="关闭"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          将 {pendingImageIds.length} 张图片添加为画布节点
        </p>

        <div className="mt-4 max-h-64 space-y-1 overflow-auto">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void addTo(null)
            }}
            className="flex w-full items-center gap-3 rounded-xl border border-dashed border-gray-300 px-4 py-3 text-left text-sm font-medium text-gray-700 transition hover:border-gray-400 hover:bg-gray-50 disabled:opacity-50 dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/5"
          >
            <PlusIcon className="h-4 w-4" />
            新建画布
          </button>
          {docs.map((doc) => (
            <button
              key={doc.id}
              type="button"
              disabled={busy}
              onClick={() => {
                void addTo(doc.id)
              }}
              className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-sm text-gray-700 transition hover:bg-gray-100 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-white/10"
            >
              <span className="truncate">{doc.title}</span>
              <span className="shrink-0 text-xs text-gray-400 dark:text-gray-500">{doc.nodes.length} 节点</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
