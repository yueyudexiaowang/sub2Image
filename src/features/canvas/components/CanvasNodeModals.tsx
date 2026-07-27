import { useEffect, useState } from 'react'
import type { TaskRecord } from '../../../types'
import { CloseIcon } from '../../../components/ui/icons'
import { getImage, getVideo } from '../../../lib/db'
import { ensureImageCached } from '../../imageLibrary'
import ToolImageSourcePicker from '../../../Tools/components/ToolImageSourcePicker'
import type { CanvasNode } from '../types'

function ModalShell({ onClose, children, wide }: { onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className={`relative max-h-[90svh] overflow-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-[#151517] ${wide ? 'w-full max-w-4xl' : 'w-full max-w-md'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
        {children}
      </div>
    </div>
  )
}

// ===== 信息弹窗 =====

export function CanvasNodeInfoModal({ node, task, onClose }: { node: CanvasNode; task?: TaskRecord; onClose: () => void }) {
  const [assetInfo, setAssetInfo] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const load = async () => {
      if (node.kind === 'image' && node.imageId) {
        const image = await getImage(node.imageId)
        if (active && image) {
          const source = { upload: '上传', generated: '生成', mask: '遮罩', edited: '编辑' }[image.source ?? 'upload'] ?? image.source
          setAssetInfo(`${image.width ?? '?'} × ${image.height ?? '?'} · 来源：${source ?? '未知'}`)
        }
      }
      if (node.kind === 'video' && node.videoId) {
        const video = await getVideo(node.videoId)
        if (active && video) setAssetInfo(`${video.width} × ${video.height} · ${Math.round(video.duration)}s · ${video.mimeType}`)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [node])

  const rows: Array<[string, string]> = [
    ['类型', node.kind === 'image' ? '图片节点' : node.kind === 'video' ? '视频节点' : '文本节点'],
    ['节点尺寸', `${Math.round(node.w)} × ${Math.round(node.h)}`],
    ['创建时间', new Date(node.createdAt).toLocaleString()],
    ...(assetInfo ? [['资产信息', assetInfo] as [string, string]] : []),
    ...(task ? [
      ['关联任务', task.prompt || task.id] as [string, string],
      ['任务状态', task.status === 'done' ? '已完成' : task.status === 'error' ? '失败' : '进行中'] as [string, string],
    ] : []),
  ]

  return (
    <ModalShell onClose={onClose}>
      <h3 className="text-base font-semibold text-gray-950 dark:text-white">节点信息</h3>
      <dl className="mt-4 space-y-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-4 text-sm">
            <dt className="w-20 shrink-0 text-gray-500 dark:text-gray-400">{label}</dt>
            <dd className="min-w-0 break-words text-gray-900 dark:text-gray-100">{value}</dd>
          </div>
        ))}
      </dl>
    </ModalShell>
  )
}

// ===== 大图预览 =====

export function CanvasNodeLightbox({ node, onClose }: { node: CanvasNode; onClose: () => void }) {
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    if (node.kind === 'image' && node.imageId) {
      void ensureImageCached(node.imageId).then((dataUrl) => {
        if (active && dataUrl) setImageUrl(dataUrl)
      })
    }
    if (node.kind === 'video' && node.videoId) {
      void getVideo(node.videoId).then((video) => {
        if (!active || !video) return
        objectUrl = URL.createObjectURL(video.blob)
        setVideoUrl(objectUrl)
      })
    }
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [node])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/90 p-6" onClick={onClose}>
      {node.kind === 'image' && (
        imageUrl
          ? <img src={imageUrl} alt="" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
          : <p className="text-sm text-gray-300">正在加载原图…</p>
      )}
      {node.kind === 'video' && (
        videoUrl
          ? <video src={videoUrl} controls autoPlay playsInline className="max-h-full max-w-full" onClick={(e) => e.stopPropagation()} />
          : <p className="text-sm text-gray-300">正在加载视频…</p>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="关闭预览"
        className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
      >
        <CloseIcon className="h-5 w-5" />
      </button>
    </div>
  )
}

// ===== 画布快捷键 =====

const SHORTCUT_GROUPS: Array<[string, Array<[string, string]>]> = [
  ['视图', [
    ['拖动空白处', '平移视图'],
    ['滚轮 / 双指', '缩放画布'],
  ]],
  ['选择与编辑', [
    ['Shift + 拖动', '框选节点'],
    ['Shift / Ctrl / Cmd + 点击', '追加选择'],
    ['Delete / Backspace', '删除选中内容'],
    ['双击文本节点', '编辑文本'],
    ['Esc', '取消选择并关闭浮层'],
  ]],
  ['创建与导入', [
    ['右键空白处', '创建文本 / 图片 / 视频节点'],
    ['从节点圆点拖出', '连接两个节点（左侧入、右侧出）'],
    ['Ctrl / Cmd + V', '粘贴图片到画布'],
    ['拖入图片或视频文件', '上传到画布'],
  ]],
]

export function CanvasShortcutsModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalShell onClose={onClose}>
      <h3 className="text-base font-semibold text-gray-950 dark:text-white">画布快捷键</h3>
      <div className="mt-4 space-y-5">
        {SHORTCUT_GROUPS.map(([group, items]) => (
          <div key={group}>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{group}</p>
            <div className="mt-2 divide-y divide-gray-100 dark:divide-white/5">
              {items.map(([keys, desc]) => (
                <div key={keys} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <kbd className="rounded-md bg-gray-100 px-2 py-1 font-mono text-xs text-gray-700 dark:bg-white/10 dark:text-gray-200">{keys}</kbd>
                  <span className="text-right text-gray-600 dark:text-gray-300">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ModalShell>
  )
}

// ===== 替换图片（上传或从图片库选择） =====

export function CanvasImagePickerModal({ title, onUpload, onSelect, onClose }: {
  title: string
  onUpload: (file: File) => void
  onSelect: (id: string) => void
  onClose: () => void
}) {
  return (
    <ModalShell onClose={onClose} wide>
      <ToolImageSourcePicker
        onUpload={onUpload}
        onSelect={onSelect}
        busy={false}
        eyebrow="无限画布"
        title={title}
        description="上传新图片，或从图片库中选择一张作为该节点的内容。"
        selectLabel="使用此图"
        emptyMessage="图片库为空，请先上传或生成图片。"
      />
    </ModalShell>
  )
}
