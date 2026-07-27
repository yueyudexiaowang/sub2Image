import { useEffect, useState } from 'react'
import { Handle, NodeResizer, NodeToolbar, Position, type Node, type NodeProps } from '@xyflow/react'
import {
  CloudIcon,
  CopyIcon,
  DownloadIcon,
  ImageIcon,
  ImportIcon,
  TrashIcon,
  VideoIcon,
} from '../../../components/ui/icons'
import { getVideo } from '../../../lib/db'
import { useStore } from '../../../state/appStore'
import { ensureImageThumbnailCached, subscribeImageThumbnail } from '../../imageLibrary'
import { useCanvasGenerationStore } from '../store/canvasGenerationStore'
import type { CanvasNodeKind } from '../types'

/** 节点功能菜单可触发的动作，由 CanvasWorkspace 统一处理。 */
export type CanvasNodeAction =
  | 'info'
  | 'delete'
  | 'duplicate'
  | 'replace'
  | 'download'
  | 'save-asset'
  | 'save-cloud'
  | 'crop'
  | 'lightbox'
  | 'toggle-aspect'
  | 'font-size'
  | 'copy-text'

// React Flow 节点 data：承载画布节点的业务字段与回调。
export type CanvasFlowData = {
  kind: CanvasNodeKind
  createdAt: number
  text?: string
  fontSize?: 'sm' | 'md' | 'lg'
  imageId?: string
  taskId?: string
  aspectLocked?: boolean
  videoId?: string
  posterImageId?: string
  onCommitText?: (id: string, text: string) => void
  onAction?: (id: string, action: CanvasNodeAction) => void
  [key: string]: unknown
}

export type CanvasFlowNode = Node<CanvasFlowData>

function useImageThumbnail(imageId?: string) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!imageId) {
      setDataUrl(null)
      return
    }
    let active = true
    const unsubscribe = subscribeImageThumbnail(imageId, (thumbnail) => {
      if (active) setDataUrl(thumbnail.dataUrl)
    })
    void ensureImageThumbnailCached(imageId).then((thumbnail) => {
      if (active && thumbnail) setDataUrl(thumbnail.dataUrl)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [imageId])

  return dataUrl
}

function useVideoObjectUrl(videoId?: string) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!videoId) {
      setUrl(null)
      return
    }
    let objectUrl: string | null = null
    let active = true
    void getVideo(videoId).then((video) => {
      if (!active || !video) return
      objectUrl = URL.createObjectURL(video.blob)
      setUrl(objectUrl)
    }).catch((err) => {
      console.warn('加载画布视频失败：', err)
    })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [videoId])

  return url
}

const NODE_SHELL_CLASS = 'h-full w-full overflow-hidden rounded-2xl border transition-colors'

function shellClass(selected: boolean | undefined, empty: boolean) {
  const border = selected
    ? 'border-lime-400 shadow-[0_0_0_1px_rgba(163,230,53,0.6)]'
    : empty
    ? 'border-gray-300 dark:border-white/15'
    : 'border-gray-200 dark:border-white/10'
  return `${NODE_SHELL_CLASS} ${border} bg-white dark:bg-black/60`
}

function MediaEmptyState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-400 dark:text-gray-500">
      {icon}
      <span className="text-sm">{label}</span>
    </div>
  )
}

// 空节点绑定生成任务后的状态展示：生成中（含图片流式预览）与失败。
function MediaTaskState({ taskId, emptyIcon, emptyLabel }: { taskId?: string; emptyIcon: React.ReactNode; emptyLabel: string }) {
  const task = useStore((s) => (taskId ? s.tasks.find((t) => t.id === taskId) : undefined))
  const streamPreview = useStore((s) => (taskId ? s.streamPreviews[taskId] : undefined))

  if (task?.status === 'running') {
    return (
      <div className="relative h-full w-full">
        {streamPreview
          ? <img src={streamPreview} alt="" draggable={false} className="h-full w-full object-cover opacity-80" />
          : <div className="h-full w-full animate-pulse bg-gray-100 dark:bg-white/5" />}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-lime-400 border-t-transparent" aria-hidden="true" />
          <span className="text-xs text-gray-500 dark:text-gray-300">生成中…</span>
        </div>
      </div>
    )
  }
  if (task?.status === 'error') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center">
        <span className="text-sm text-red-500">生成失败</span>
        {task.error && <span className="line-clamp-3 text-xs text-gray-500 dark:text-gray-400">{task.error}</span>}
        <span className="text-xs text-gray-400 dark:text-gray-500">选中节点后可在输入框重新生成</span>
      </div>
    )
  }
  return <MediaEmptyState icon={emptyIcon} label={emptyLabel} />
}

// ===== 节点功能菜单 =====

type MenuItem = {
  action: CanvasNodeAction
  label: string
  icon: React.ReactNode
  danger?: boolean
}

function InfoGlyph() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="h-4 w-4">
      <circle cx={12} cy={12} r={9} strokeWidth={2} />
      <path strokeLinecap="round" strokeWidth={2} d="M12 11v5m0-8v.01" />
    </svg>
  )
}

function CropGlyph() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 2v15a2 2 0 002 2h13M2 7h15a2 2 0 012 2v13" />
    </svg>
  )
}

function ExpandGlyph() {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 21H3v-6m18-6V3h-6m6 0l-7 7M3 21l7-7" />
    </svg>
  )
}

function LockGlyph({ locked }: { locked: boolean }) {
  return (
    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="h-4 w-4">
      <rect x={5} y={11} width={14} height={9} rx={2} strokeWidth={2} />
      {locked
        ? <path strokeLinecap="round" strokeWidth={2} d="M8 11V7a4 4 0 018 0v4" />
        : <path strokeLinecap="round" strokeWidth={2} d="M8 11V7a4 4 0 017.87-1" />}
    </svg>
  )
}

function NodeActionMenu({ id, items, visible, onAction }: {
  id: string
  items: MenuItem[]
  visible: boolean
  onAction?: (id: string, action: CanvasNodeAction) => void
}) {
  return (
    <NodeToolbar isVisible={visible} position={Position.Top} offset={12} className="nodrag">
      <div className="grid max-w-[420px] grid-cols-5 gap-1 rounded-2xl border border-gray-200 bg-white p-2 shadow-xl dark:border-white/10 dark:bg-[#151517]">
        {items.map((item) => (
          <button
            key={item.action}
            type="button"
            onClick={() => onAction?.(id, item.action)}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs transition hover:bg-gray-100 dark:hover:bg-white/10 ${item.danger ? 'text-red-500' : 'text-gray-700 dark:text-gray-200'}`}
          >
            {item.icon}
            <span className="whitespace-nowrap">{item.label}</span>
          </button>
        ))}
      </div>
    </NodeToolbar>
  )
}

const FONT_SIZE_CLASS = { sm: 'text-sm', md: 'text-base', lg: 'text-2xl' } as const
const FONT_SIZE_LABEL = { sm: '小', md: '中', lg: '大' } as const

export function CanvasTextNodeView({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(data.text ?? '')
  const generating = useCanvasGenerationStore((s) => s.runningTextNodeId === id)
  const fontClass = FONT_SIZE_CLASS[data.fontSize ?? 'md']

  useEffect(() => {
    if (!editing) setValue(data.text ?? '')
  }, [data.text, editing])

  const items: MenuItem[] = [
    { action: 'font-size', label: `字号 ${FONT_SIZE_LABEL[data.fontSize ?? 'md']}`, icon: <span className="text-sm font-semibold leading-none">T</span> },
    { action: 'copy-text', label: '复制文本', icon: <CopyIcon className="h-4 w-4" /> },
    { action: 'duplicate', label: '复制', icon: <CopyIcon className="h-4 w-4" /> },
    { action: 'delete', label: '删除', icon: <TrashIcon className="h-4 w-4" />, danger: true },
  ]

  return (
    <div className={shellClass(selected, false)} onDoubleClick={() => setEditing(true)}>
      <NodeActionMenu id={id} items={items} visible={!!selected && !editing} onAction={data.onAction} />
      <NodeResizer isVisible={!!selected} minWidth={120} minHeight={60} />
      {editing ? (
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            setEditing(false)
            data.onCommitText?.(id, value)
          }}
          className={`nodrag h-full w-full resize-none bg-transparent p-3 outline-none text-gray-900 dark:text-gray-100 ${fontClass}`}
          placeholder="输入文本…"
        />
      ) : generating ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-lime-400 border-t-transparent" aria-hidden="true" />
          <span className="text-xs text-gray-500 dark:text-gray-300">生成中…</span>
        </div>
      ) : (
        <div className={`h-full w-full overflow-hidden whitespace-pre-wrap p-3 text-gray-900 dark:text-gray-100 ${fontClass}`}>
          {data.text || <span className="text-gray-400 dark:text-gray-500">双击编辑，或选中后用输入框生成</span>}
        </div>
      )}
      <Handle type="target" position={Position.Left} className="!h-3.5 !w-3.5 !border-2 !border-lime-400 !bg-black transition-transform hover:!scale-150" />
      <Handle type="source" position={Position.Right} className="!h-3.5 !w-3.5 !border-2 !border-lime-400 !bg-black transition-transform hover:!scale-150" />
    </div>
  )
}

export function CanvasImageNodeView({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const thumbnail = useImageThumbnail(data.imageId)
  const locked = data.aspectLocked !== false

  const items: MenuItem[] = data.imageId
    ? [
        { action: 'info', label: '信息', icon: <InfoGlyph /> },
        { action: 'delete', label: '删除', icon: <TrashIcon className="h-4 w-4" />, danger: true },
        { action: 'save-asset', label: '存资产', icon: <ImageIcon className="h-4 w-4" /> },
        { action: 'save-cloud', label: '云储存', icon: <CloudIcon className="h-4 w-4" /> },
        { action: 'download', label: '下载', icon: <DownloadIcon className="h-4 w-4" /> },
        { action: 'duplicate', label: '复制', icon: <CopyIcon className="h-4 w-4" /> },
        { action: 'replace', label: '替换', icon: <ImportIcon className="h-4 w-4" /> },
        { action: 'toggle-aspect', label: locked ? '锁定比例' : '比例已解锁', icon: <LockGlyph locked={locked} /> },
        { action: 'crop', label: '裁剪', icon: <CropGlyph /> },
        { action: 'lightbox', label: '大图', icon: <ExpandGlyph /> },
      ]
    : [
        { action: 'replace', label: '选择图片', icon: <ImportIcon className="h-4 w-4" /> },
        { action: 'duplicate', label: '复制', icon: <CopyIcon className="h-4 w-4" /> },
        { action: 'delete', label: '删除', icon: <TrashIcon className="h-4 w-4" />, danger: true },
      ]

  return (
    <div className={shellClass(selected, !data.imageId)}>
      <NodeActionMenu id={id} items={items} visible={!!selected} onAction={data.onAction} />
      <NodeResizer isVisible={!!selected} minWidth={120} minHeight={80} keepAspectRatio={locked && !!data.imageId} />
      {data.imageId
        ? thumbnail
          ? <img src={thumbnail} alt="" draggable={false} className="h-full w-full object-cover" />
          : <div className="h-full w-full animate-pulse bg-gray-100 dark:bg-white/5" />
        : <MediaTaskState taskId={data.taskId} emptyIcon={<ImageIcon className="h-6 w-6" />} emptyLabel="空图片节点" />}
      <Handle type="target" position={Position.Left} className="!h-3.5 !w-3.5 !border-2 !border-lime-400 !bg-black transition-transform hover:!scale-150" />
      <Handle type="source" position={Position.Right} className="!h-3.5 !w-3.5 !border-2 !border-lime-400 !bg-black transition-transform hover:!scale-150" />
    </div>
  )
}

export function CanvasVideoNodeView({ id, data, selected }: NodeProps<CanvasFlowNode>) {
  const videoUrl = useVideoObjectUrl(data.videoId)
  const poster = useImageThumbnail(data.posterImageId)

  const items: MenuItem[] = data.videoId
    ? [
        { action: 'info', label: '信息', icon: <InfoGlyph /> },
        { action: 'delete', label: '删除', icon: <TrashIcon className="h-4 w-4" />, danger: true },
        { action: 'save-asset', label: '存资产', icon: <VideoIcon className="h-4 w-4" /> },
        { action: 'save-cloud', label: '云储存', icon: <CloudIcon className="h-4 w-4" /> },
        { action: 'download', label: '下载', icon: <DownloadIcon className="h-4 w-4" /> },
        { action: 'duplicate', label: '复制', icon: <CopyIcon className="h-4 w-4" /> },
        { action: 'replace', label: '替换', icon: <ImportIcon className="h-4 w-4" /> },
        { action: 'lightbox', label: '大图', icon: <ExpandGlyph /> },
      ]
    : [
        { action: 'replace', label: '上传视频', icon: <ImportIcon className="h-4 w-4" /> },
        { action: 'duplicate', label: '复制', icon: <CopyIcon className="h-4 w-4" /> },
        { action: 'delete', label: '删除', icon: <TrashIcon className="h-4 w-4" />, danger: true },
      ]

  return (
    <div className={shellClass(selected, !data.videoId)}>
      <NodeActionMenu id={id} items={items} visible={!!selected} onAction={data.onAction} />
      <NodeResizer isVisible={!!selected} minWidth={160} minHeight={100} keepAspectRatio={!!data.videoId} />
      {data.videoId
        ? videoUrl
          ? <video src={videoUrl} poster={poster ?? undefined} controls playsInline className="nodrag h-full w-full object-contain bg-black" />
          : <div className="h-full w-full animate-pulse bg-gray-100 dark:bg-white/5" />
        : <MediaTaskState taskId={data.taskId} emptyIcon={<VideoIcon className="h-6 w-6" />} emptyLabel="空视频节点" />}
      <Handle type="target" position={Position.Left} className="!h-3.5 !w-3.5 !border-2 !border-lime-400 !bg-black transition-transform hover:!scale-150" />
      <Handle type="source" position={Position.Right} className="!h-3.5 !w-3.5 !border-2 !border-lime-400 !bg-black transition-transform hover:!scale-150" />
    </div>
  )
}

export const canvasNodeTypes = {
  text: CanvasTextNodeView,
  image: CanvasImageNodeView,
  video: CanvasVideoNodeView,
}
