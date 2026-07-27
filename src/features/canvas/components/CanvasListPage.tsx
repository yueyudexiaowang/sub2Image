import { useEffect, useState } from 'react'
import { AiLiquidModeSwitch } from '../../../components/aiLiquidModeSwitch'
import { PlusIcon, TrashIcon } from '../../../components/ui/icons'
import { deleteCanvasDocument, getAllCanvasDocuments, putCanvasDocument } from '../../../lib/db'
import { genId } from '../../../lib/id'
import { useStore } from '../../../state/appStore'
import { createCanvasDocument, normalizeCanvasDocument } from '../core/documents'
import type { CanvasDocument } from '../types'
import { leaveCanvas, navigateToCanvas } from '../canvasRoutes'
import CanvasPreview from './CanvasPreview'

export default function CanvasListPage() {
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const [docs, setDocs] = useState<CanvasDocument[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void getAllCanvasDocuments().then((items) => {
      if (!active) return
      const normalized = items
        .map(normalizeCanvasDocument)
        .filter((doc): doc is CanvasDocument => doc !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt)
      setDocs(normalized)
    }).catch((err) => {
      console.error('加载画布列表失败：', err)
      if (active) showToast('加载画布列表失败', 'error')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [showToast])

  const createDoc = async () => {
    const doc = createCanvasDocument(genId(), `无限画布 ${docs.length + 1}`)
    await putCanvasDocument(doc)
    navigateToCanvas(doc.id)
  }

  const removeDoc = (doc: CanvasDocument) => {
    setConfirmDialog({
      title: '删除画布',
      message: `确定删除「${doc.title}」吗？画布内的节点布局将被删除，画廊中的资产不受影响。`,
      tone: 'danger',
      confirmText: '删除',
      action: () => {
        void deleteCanvasDocument(doc.id).then(() => {
          setDocs((prev) => prev.filter((item) => item.id !== doc.id))
          showToast('画布已删除', 'success')
        }).catch((err) => {
          console.error('删除画布失败：', err)
          showToast('删除画布失败', 'error')
        })
      },
    })
  }

  return (
    <main className="min-h-svh bg-gray-50 dark:bg-[#0a0a0b]">
      <div className="safe-area-x mx-auto max-w-6xl px-4 py-8">
        <div className="flex items-center justify-between gap-4">
          <AiLiquidModeSwitch
            value="canvas"
            onChange={(mode) => {
              if (mode === 'gallery') leaveCanvas()
            }}
            className="w-[168px] shrink-0"
          />
          <button
            type="button"
            onClick={() => {
              void createDoc()
            }}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-gray-950 px-4 text-sm font-medium text-white transition hover:bg-gray-800 dark:bg-white dark:text-gray-950 dark:hover:bg-gray-200"
          >
            <PlusIcon className="h-4 w-4" />
            新建画布
          </button>
        </div>

        <div className="mt-10">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">画布库</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-gray-950 dark:text-white">无限画布</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">保存创作上下文，继续组织节点、连线和生成结果。</p>
        </div>

        {loading ? (
          <p className="mt-16 text-center text-sm text-gray-500 dark:text-gray-400">正在加载…</p>
        ) : docs.length === 0 ? (
          <div className="mt-16 text-center">
            <p className="text-sm text-gray-500 dark:text-gray-400">还没有画布，点击「新建画布」开始自由编排图片、视频与文本。</p>
          </div>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {docs.map((doc) => (
              <div
                key={doc.id}
                role="button"
                tabIndex={0}
                onClick={() => navigateToCanvas(doc.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') navigateToCanvas(doc.id)
                }}
                className="group cursor-pointer overflow-hidden rounded-2xl border border-gray-200 bg-white transition hover:border-gray-300 hover:shadow-md dark:border-white/10 dark:bg-[#151517] dark:hover:border-white/20"
              >
                <div className="aspect-video w-full overflow-hidden bg-gray-100 p-2 dark:bg-black/40">
                  <CanvasPreview doc={doc} />
                </div>
                <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{doc.title}</p>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-500">
                      {doc.nodes.length} 个节点 · {doc.edges.length} 条连线 · {new Date(doc.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeDoc(doc)
                    }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-500/10"
                    aria-label={`删除画布 ${doc.title}`}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
