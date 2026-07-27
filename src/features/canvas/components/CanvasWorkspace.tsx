import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ChevronLeftIcon, ImageIcon, ImportIcon, KeyboardIcon, TrashIcon, VideoIcon } from '../../../components/ui/icons'
import { navigateToExtensionWorkspace } from '../../../ExtensionWorkspace'
import { getCanvasDocument, getImage } from '../../../lib/db'
import { genId } from '../../../lib/id'
import { useStore } from '../../../state/appStore'
import {
  DEFAULT_MEDIA_NODE_SIZE,
  collectUpstreamMaterials,
  createCanvasNode,
  isValidCanvasConnection,
  normalizeCanvasDocument,
} from '../core/documents'
import { useCanvasGenerationStore } from '../store/canvasGenerationStore'
import type { CanvasDocument, CanvasNode, CanvasNodeKind } from '../types'
import { importCanvasImageFile, importCanvasVideoFile } from '../adapters/mediaImport'
import { downloadNodeAsset, saveNodeAsset, saveNodeToCloud } from '../adapters/nodeAssets'
import { navigateToCanvas } from '../canvasRoutes'
import { flushCanvasSave, scheduleCanvasSave } from '../store/canvasPersistence'
import { CanvasImagePickerModal, CanvasNodeInfoModal, CanvasNodeLightbox, CanvasShortcutsModal } from './CanvasNodeModals'
import { canvasNodeTypes, type CanvasFlowNode, type CanvasNodeAction } from './nodes'

type Props = {
  docId: string
}

// 按资产宽高比推导媒体节点的初始尺寸。
function mediaNodeSize(width?: number, height?: number) {
  if (!width || !height) return DEFAULT_MEDIA_NODE_SIZE
  const w = DEFAULT_MEDIA_NODE_SIZE.w
  return { w, h: Math.min(640, Math.max(80, Math.round((w * height) / width))) }
}

function toDocNode(node: CanvasFlowNode): CanvasNode {
  const base = {
    id: node.id,
    x: node.position.x,
    y: node.position.y,
    w: node.width ?? node.measured?.width ?? DEFAULT_MEDIA_NODE_SIZE.w,
    h: node.height ?? node.measured?.height ?? DEFAULT_MEDIA_NODE_SIZE.h,
    createdAt: node.data.createdAt,
  }
  if (node.data.kind === 'text') {
    return { ...base, kind: 'text', text: node.data.text ?? '', fontSize: node.data.fontSize ?? 'md' }
  }
  if (node.data.kind === 'image') {
    return { ...base, kind: 'image', imageId: node.data.imageId, taskId: node.data.taskId, aspectLocked: node.data.aspectLocked }
  }
  return { ...base, kind: 'video', videoId: node.data.videoId, posterImageId: node.data.posterImageId, taskId: node.data.taskId }
}

export default function CanvasWorkspace({ docId }: Props) {
  return (
    <ReactFlowProvider>
      <CanvasWorkspaceInner docId={docId} />
    </ReactFlowProvider>
  )
}

function CanvasWorkspaceInner({ docId }: Props) {
  const showToast = useStore((s) => s.showToast)
  const theme = useStore((s) => s.settings.theme)
  const tasks = useStore((s) => s.tasks)
  const setGenerationTarget = useCanvasGenerationStore((s) => s.setTarget)
  const { screenToFlowPosition, getViewport } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [doc, setDoc] = useState<CanvasDocument | null>(null)
  const [title, setTitle] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [infoNode, setInfoNode] = useState<CanvasNode | null>(null)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [lightboxNode, setLightboxNode] = useState<CanvasNode | null>(null)
  const [replaceImageTarget, setReplaceImageTarget] = useState<string | null>(null)
  const loadedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoReplaceInputRef = useRef<HTMLInputElement>(null)
  const videoReplaceTargetRef = useRef<string | null>(null)
  // 节点菜单动作的分发器每次渲染更新，避免与 toFlowNode 形成循环依赖。
  const actionRef = useRef<(id: string, action: CanvasNodeAction) => void>(() => {})

  const commitText = useCallback((id: string, text: string) => {
    setNodes((prev) => prev.map((node) => (node.id === id ? { ...node, data: { ...node.data, text } } : node)))
  }, [setNodes])

  const dispatchAction = useCallback((id: string, action: CanvasNodeAction) => {
    actionRef.current(id, action)
  }, [])

  // 局部更新节点 data 与尺寸（替换内容后按新资产宽高比调整）。
  const patchNode = useCallback((id: string, dataPatch: Partial<CanvasNode>, size?: { w: number; h: number }) => {
    setNodes((prev) => prev.map((n) => (n.id === id
      ? { ...n, ...(size ? { width: size.w, height: size.h } : {}), data: { ...n.data, ...dataPatch } }
      : n)))
  }, [setNodes])

  const toFlowNode = useCallback((node: CanvasNode): CanvasFlowNode => ({
    id: node.id,
    type: node.kind,
    position: { x: node.x, y: node.y },
    width: node.w,
    height: node.h,
    data: {
      ...node,
      onCommitText: commitText,
      onAction: dispatchAction,
    },
  }), [commitText, dispatchAction])

  // 加载文档
  useEffect(() => {
    let active = true
    void getCanvasDocument(docId).then((raw) => {
      if (!active) return
      const loaded = normalizeCanvasDocument(raw)
      if (!loaded) {
        showToast('画布不存在或已被删除', 'error')
        navigateToCanvas()
        return
      }
      setDoc(loaded)
      setTitle(loaded.title)
      setNodes(loaded.nodes.map(toFlowNode))
      setEdges(loaded.edges.map((edge) => ({ ...edge, type: 'default' })))
      loadedRef.current = true
    }).catch((err) => {
      console.error('加载画布失败：', err)
      if (active) showToast('加载画布失败', 'error')
    })
    return () => {
      active = false
    }
  }, [docId, setEdges, setNodes, showToast, toFlowNode])

  // 内容变化时去抖保存；卸载时冲刷
  useEffect(() => {
    if (!loadedRef.current || !doc) return
    scheduleCanvasSave({
      ...doc,
      title,
      nodes: nodes.map(toDocNode),
      edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
      viewport: getViewport(),
      updatedAt: Date.now(),
    })
  }, [doc, edges, getViewport, nodes, title])

  useEffect(() => {
    const flush = () => {
      void flushCanvasSave()
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      void flushCanvasSave()
    }
  }, [])

  const addNode = useCallback((kind: CanvasNodeKind, position: { x: number; y: number }, patch?: Partial<CanvasNode>) => {
    const node = { ...createCanvasNode(kind, genId(), position.x, position.y), ...patch } as CanvasNode
    setNodes((prev) => [...prev, { ...toFlowNode(node), selected: true }].map((n) => (n.id === node.id ? n : { ...n, selected: false })))
  }, [setNodes, toFlowNode])

  const viewportCenter = useCallback(() => {
    return screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  }, [screenToFlowPosition])

  const importFiles = useCallback(async (files: Iterable<File>, position: { x: number; y: number }) => {
    let offset = 0
    for (const file of files) {
      try {
        if (file.type.startsWith('image/')) {
          const imported = await importCanvasImageFile(file)
          if (!imported) continue
          const size = mediaNodeSize(imported.width, imported.height)
          addNode('image', { x: position.x + offset, y: position.y + offset }, { ...size, imageId: imported.imageId })
          offset += 32
        } else if (file.type.startsWith('video/')) {
          const imported = await importCanvasVideoFile(file)
          if (!imported) continue
          const size = mediaNodeSize(imported.width, imported.height)
          addNode('video', { x: position.x + offset, y: position.y + offset }, { ...size, videoId: imported.videoId, posterImageId: imported.posterImageId })
          offset += 32
        }
      } catch (err) {
        console.error('导入文件失败：', err)
        showToast(`导入 ${file.name} 失败`, 'error')
      }
    }
  }, [addNode, showToast])

  // 粘贴图片进画布
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest('textarea, input, [contenteditable]')) return
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
      if (!files.length) return
      e.preventDefault()
      void importFiles(files, viewportCenter())
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [importFiles, viewportCenter])

  // 选中唯一的空图片/视频节点时，设为画布生成目标（composer 据此弹出）
  useEffect(() => {
    if (!loadedRef.current) return
    const selected = nodes.filter((n) => n.selected)
    const node = selected.length === 1 ? selected[0] : null
    const generatable = node && (
      (node.data.kind === 'image' && !node.data.imageId) ||
      (node.data.kind === 'video' && !node.data.videoId) ||
      (node.data.kind === 'text' && !(node.data.text ?? '').trim())
    )
    if (!node || !generatable) {
      setGenerationTarget(null)
      return
    }
    const materials = collectUpstreamMaterials(
      nodes.map(toDocNode),
      edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
      node.id,
    )
    setGenerationTarget({
      documentId: docId,
      nodeId: node.id,
      kind: node.data.kind,
      upstreamImageIds: materials.imageIds,
      upstreamText: materials.text,
    })
  }, [docId, edges, nodes, setGenerationTarget])

  // 消费文本生成结果，回填到文本节点
  const textResult = useCanvasGenerationStore((s) => s.textResult)
  const setTextResult = useCanvasGenerationStore((s) => s.setTextResult)
  useEffect(() => {
    if (!textResult) return
    patchNode(textResult.nodeId, { text: textResult.text })
    setTextResult(null)
  }, [patchNode, setTextResult, textResult])

  // 离开画布时清空生成目标
  useEffect(() => () => setGenerationTarget(null), [setGenerationTarget])

  // 任务状态同步：绑定新任务 id，任务完成后把产出回填到节点
  useEffect(() => {
    if (!loadedRef.current) return
    for (const node of nodes) {
      const kind = node.data.kind
      if (kind !== 'image' && kind !== 'video') continue
      if (!node.data.taskId) {
        const bound = tasks.find((t) => t.canvasDocumentId === docId && t.canvasNodeId === node.id)
        if (bound) patchNode(node.id, { taskId: bound.id })
        continue
      }
      const task = tasks.find((t) => t.id === node.data.taskId)
      if (task?.status !== 'done') continue
      if (kind === 'image' && !node.data.imageId && task.outputImages[0]) {
        patchNode(node.id, { imageId: task.outputImages[0] })
      }
      if (kind === 'video' && !node.data.videoId && task.outputVideoIds?.[0]) {
        patchNode(node.id, { videoId: task.outputVideoIds[0], posterImageId: task.outputImages[0] })
      }
    }
  }, [docId, nodes, patchNode, tasks])

  // Esc 关闭右键创建菜单
  useEffect(() => {
    if (!menu) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [menu])

  const onConnect = useCallback((connection: Connection) => {
    setEdges((prev) => addEdge({ ...connection, id: genId() }, prev))
  }, [setEdges])

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    if (!connection.source || !connection.target) return false
    return isValidCanvasConnection(
      nodes.map(toDocNode),
      edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
      connection.source,
      connection.target,
    )
  }, [edges, nodes])

  const onMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
    if (!loadedRef.current || !doc) return
    setDoc((prev) => (prev ? { ...prev, viewport } : prev))
  }, [doc])

  const deleteSelection = useCallback(() => {
    setNodes((prev) => {
      const removed = new Set(prev.filter((n) => n.selected).map((n) => n.id))
      if (removed.size) setEdges((prevEdges) => prevEdges.filter((e) => !removed.has(e.source) && !removed.has(e.target) && !e.selected))
      return prev.filter((n) => !n.selected)
    })
  }, [setEdges, setNodes])

  // 节点功能菜单动作分发（每次渲染重建以捕获最新 state）。
  actionRef.current = (id, action) => {
    const flowNode = nodes.find((n) => n.id === id)
    if (!flowNode) return
    const node = toDocNode(flowNode)

    const runAsync = (label: string, fn: () => Promise<void>) => {
      void fn().then(() => showToast(`${label}成功`, 'success')).catch((err) => {
        console.error(`${label}失败：`, err)
        showToast(`${label}失败：${err instanceof Error ? err.message : String(err)}`, 'error')
      })
    }

    if (action === 'delete') {
      setNodes((prev) => prev.filter((n) => n.id !== id))
      setEdges((prev) => prev.filter((e) => e.source !== id && e.target !== id))
      return
    }
    if (action === 'duplicate') {
      const copy: CanvasFlowNode = {
        ...flowNode,
        id: genId(),
        position: { x: flowNode.position.x + 32, y: flowNode.position.y + 32 },
        selected: true,
        data: { ...flowNode.data, createdAt: Date.now() },
      }
      setNodes((prev) => [...prev.map((n) => ({ ...n, selected: false })), copy])
      return
    }
    if (action === 'toggle-aspect') {
      patchNode(id, { aspectLocked: flowNode.data.aspectLocked === false })
      return
    }
    if (action === 'font-size') {
      const next = { sm: 'md', md: 'lg', lg: 'sm' }[flowNode.data.fontSize ?? 'md'] as 'sm' | 'md' | 'lg'
      patchNode(id, { fontSize: next })
      return
    }
    if (action === 'copy-text') {
      void navigator.clipboard.writeText(flowNode.data.text ?? '').then(() => showToast('文本已复制', 'success')).catch(() => showToast('复制失败', 'error'))
      return
    }
    if (action === 'info') {
      setInfoNode(node)
      return
    }
    if (action === 'lightbox') {
      setLightboxNode(node)
      return
    }
    if (action === 'replace') {
      if (node.kind === 'image') setReplaceImageTarget(id)
      if (node.kind === 'video') {
        videoReplaceTargetRef.current = id
        videoReplaceInputRef.current?.click()
      }
      return
    }
    if (action === 'crop' && node.kind === 'image' && node.imageId) {
      const imageId = node.imageId
      void flushCanvasSave().then(() => navigateToExtensionWorkspace('tools', 'image-editor', { image: imageId }))
      return
    }
    if (node.kind === 'text') return
    if (action === 'download') runAsync('下载', () => downloadNodeAsset(node))
    if (action === 'save-asset') {
      runAsync('存资产', async () => {
        const taskId = await saveNodeAsset(node)
        patchNode(id, { taskId })
      })
    }
    if (action === 'save-cloud') runAsync('云储存', () => saveNodeToCloud(node))
  }

  if (!doc) {
    return (
      <div className="flex h-svh items-center justify-center bg-gray-50 text-sm text-gray-500 dark:bg-[#0a0a0b] dark:text-gray-400">
        正在加载画布…
      </div>
    )
  }

  return (
    <div className="h-svh w-full bg-gray-50 dark:bg-[#0a0a0b]">
      {/* 顶栏：返回 + 标题 */}
      <div className="absolute left-0 right-0 top-0 z-20 flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => {
            void flushCanvasSave().then(() => navigateToCanvas())
          }}
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-100 dark:border-white/10 dark:bg-black/60 dark:text-gray-300 dark:hover:bg-white/10"
          aria-label="返回画布列表"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-56 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm font-medium text-gray-900 outline-none transition focus:border-gray-300 focus:bg-white dark:text-gray-100 dark:focus:border-white/15 dark:focus:bg-black/60"
          aria-label="画布名称"
        />
        <button
          type="button"
          onClick={() => setShowShortcuts(true)}
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-100 dark:border-white/10 dark:bg-black/60 dark:text-gray-300 dark:hover:bg-white/10"
          aria-label="画布快捷键"
          title="画布快捷键"
        >
          <KeyboardIcon className="h-4 w-4" />
        </button>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={canvasNodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onMoveEnd={onMoveEnd}
        defaultViewport={doc.viewport}
        fitView={!doc.viewport}
        minZoom={0.02}
        maxZoom={4}
        colorMode={theme === 'system' ? 'system' : theme}
        connectionRadius={40}
        multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
        deleteKeyCode={['Backspace', 'Delete']}
        onPaneContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
        onPaneClick={() => setMenu(null)}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDrop={(e) => {
          e.preventDefault()
          const files = Array.from(e.dataTransfer.files)
          if (!files.length) return
          void importFiles(files, screenToFlowPosition({ x: e.clientX, y: e.clientY }))
        }}
        proOptions={{ hideAttribution: true }}
        className="dark:!bg-[#0a0a0b]"
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.5} className="dark:!bg-[#0a0a0b]" />
        <Controls position="bottom-left" showInteractive={false} />
      </ReactFlow>

      {/* 右键创建菜单 */}
      {menu && (
        <div
          className="fixed z-30 w-48 overflow-hidden rounded-2xl border border-gray-200 bg-white py-2 shadow-xl dark:border-white/10 dark:bg-[#151517]"
          style={{ left: menu.x, top: menu.y }}
        >
          {([
            ['text', '添加文本节点', <span key="t" className="text-base font-semibold">T</span>],
            ['image', '添加图片节点', <ImageIcon key="i" className="h-4 w-4" />],
            ['video', '添加视频节点', <VideoIcon key="v" className="h-4 w-4" />],
          ] as const).map(([kind, label, icon]) => (
            <button
              key={kind}
              type="button"
              onClick={() => {
                addNode(kind, screenToFlowPosition({ x: menu.x, y: menu.y }))
                setMenu(null)
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-gray-700 transition hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10"
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      )}

      {/* 底部工具栏 */}
      <div className="absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-lg dark:border-white/10 dark:bg-[#151517]">
        <ToolbarButton label="添加文本节点" onClick={() => addNode('text', viewportCenter())}>
          <span className="text-base font-semibold">T</span>
        </ToolbarButton>
        <ToolbarButton label="添加图片节点" onClick={() => addNode('image', viewportCenter())}>
          <ImageIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="添加视频节点" onClick={() => addNode('video', viewportCenter())}>
          <VideoIcon className="h-4 w-4" />
        </ToolbarButton>
        <div className="mx-1 h-5 w-px bg-gray-200 dark:bg-white/10" />
        <ToolbarButton label="上传图片或视频" onClick={() => fileInputRef.current?.click()}>
          <ImportIcon className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="删除选中" onClick={deleteSelection}>
          <TrashIcon className="h-4 w-4 text-red-500" />
        </ToolbarButton>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) void importFiles(files, viewportCenter())
        }}
      />

      {/* 替换视频的隐藏文件选择 */}
      <input
        ref={videoReplaceInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          const target = videoReplaceTargetRef.current
          videoReplaceTargetRef.current = null
          if (!file || !target) return
          void importCanvasVideoFile(file).then((imported) => {
            if (!imported) return
            patchNode(target, { videoId: imported.videoId, posterImageId: imported.posterImageId, taskId: undefined }, mediaNodeSize(imported.width, imported.height))
            showToast('视频已替换', 'success')
          }).catch((err) => {
            console.error('替换视频失败：', err)
            showToast('替换视频失败', 'error')
          })
        }}
      />

      {infoNode && (
        <CanvasNodeInfoModal
          node={infoNode}
          task={useStore.getState().tasks.find((t) => {
            if (infoNode.kind === 'image') return t.id === infoNode.taskId || (infoNode.imageId ? t.outputImages?.includes(infoNode.imageId) : false)
            if (infoNode.kind === 'video') return t.id === infoNode.taskId || (infoNode.videoId ? t.outputVideoIds?.includes(infoNode.videoId) : false)
            return false
          })}
          onClose={() => setInfoNode(null)}
        />
      )}
      {lightboxNode && <CanvasNodeLightbox node={lightboxNode} onClose={() => setLightboxNode(null)} />}
      {showShortcuts && <CanvasShortcutsModal onClose={() => setShowShortcuts(false)} />}
      {replaceImageTarget && (
        <CanvasImagePickerModal
          title="替换图片"
          onClose={() => setReplaceImageTarget(null)}
          onUpload={(file) => {
            const target = replaceImageTarget
            setReplaceImageTarget(null)
            void importCanvasImageFile(file).then((imported) => {
              if (!imported) return
              patchNode(target, { imageId: imported.imageId, taskId: undefined }, mediaNodeSize(imported.width, imported.height))
              showToast('图片已替换', 'success')
            }).catch((err) => {
              console.error('替换图片失败：', err)
              showToast('替换图片失败', 'error')
            })
          }}
          onSelect={(imageId) => {
            const target = replaceImageTarget
            setReplaceImageTarget(null)
            void getImage(imageId).then((image) => {
              patchNode(target, { imageId, taskId: undefined }, mediaNodeSize(image?.width, image?.height))
              showToast('图片已替换', 'success')
            }).catch((err) => {
              console.error('替换图片失败：', err)
              showToast('替换图片失败', 'error')
            })
          }}
        />
      )}
    </div>
  )
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-600 transition hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
    >
      {children}
    </button>
  )
}
