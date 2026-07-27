import { useEffect, useState } from 'react'
import { ensureImageThumbnailCached } from '../../imageLibrary'
import type { CanvasDocument, CanvasNode } from '../types'

const KIND_LABEL = { text: '文本', image: '图像', video: '视频' } as const
const PADDING = 60

function nodeThumbnailId(node: CanvasNode) {
  if (node.kind === 'image') return node.imageId
  if (node.kind === 'video') return node.posterImageId
  return undefined
}

/** 画布列表卡片的示意缩略图：点阵背景 + 节点框 + 连线，按文档内容等比缩放。 */
export default function CanvasPreview({ doc }: { doc: CanvasDocument }) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const thumbnailIds = doc.nodes.map(nodeThumbnailId).filter((id): id is string => !!id)
  const thumbnailKey = thumbnailIds.join(',')

  useEffect(() => {
    let active = true
    for (const id of thumbnailKey.split(',').filter(Boolean)) {
      void ensureImageThumbnailCached(id).then((thumbnail) => {
        if (active && thumbnail) setThumbs((prev) => (prev[id] ? prev : { ...prev, [id]: thumbnail.dataUrl }))
      })
    }
    return () => {
      active = false
    }
  }, [thumbnailKey])

  const bounds = doc.nodes.length
    ? {
        minX: Math.min(...doc.nodes.map((n) => n.x)) - PADDING,
        minY: Math.min(...doc.nodes.map((n) => n.y)) - PADDING,
        maxX: Math.max(...doc.nodes.map((n) => n.x + n.w)) + PADDING,
        maxY: Math.max(...doc.nodes.map((n) => n.y + n.h)) + PADDING,
      }
    : { minX: 0, minY: 0, maxX: 800, maxY: 450 }
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  const nodeById = new Map(doc.nodes.map((node) => [node.id, node]))
  const patternId = `canvas-dots-${doc.id}`

  return (
    <svg
      viewBox={`${bounds.minX} ${bounds.minY} ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full"
      role="img"
      aria-label={`画布预览：${doc.title}`}
    >
      <defs>
        <pattern id={patternId} width={64} height={64} patternUnits="userSpaceOnUse">
          <circle cx={4} cy={4} r={2} className="fill-gray-300 dark:fill-white/15" />
        </pattern>
        {doc.nodes.map((node) => (
          <clipPath key={node.id} id={`clip-${doc.id}-${node.id}`}>
            <rect x={node.x} y={node.y} width={node.w} height={node.h} rx={18} />
          </clipPath>
        ))}
      </defs>

      <rect x={bounds.minX} y={bounds.minY} width={width} height={height} fill={`url(#${patternId})`} />

      {doc.edges.map((edge) => {
        const source = nodeById.get(edge.source)
        const target = nodeById.get(edge.target)
        if (!source || !target) return null
        const x1 = source.x + source.w
        const y1 = source.y + source.h / 2
        const x2 = target.x
        const y2 = target.y + target.h / 2
        const dx = Math.max(40, Math.abs(x2 - x1) / 2)
        return (
          <path
            key={edge.id}
            d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
            fill="none"
            strokeWidth={3}
            className="stroke-gray-300 dark:stroke-white/25"
          />
        )
      })}

      {doc.nodes.map((node) => {
        const thumbId = nodeThumbnailId(node)
        const thumb = thumbId ? thumbs[thumbId] : undefined
        return (
          <g key={node.id}>
            <rect
              x={node.x}
              y={node.y}
              width={node.w}
              height={node.h}
              rx={18}
              strokeWidth={2}
              className="fill-gray-50 stroke-gray-300 dark:fill-black/60 dark:stroke-white/20"
            />
            {thumb && (
              <image
                href={thumb}
                x={node.x}
                y={node.y}
                width={node.w}
                height={node.h}
                preserveAspectRatio="xMidYMid slice"
                clipPath={`url(#clip-${doc.id}-${node.id})`}
              />
            )}
            {!thumb && (
              <text
                x={node.x + 18}
                y={node.y + 38}
                fontSize={26}
                className="fill-gray-500 dark:fill-gray-300"
              >
                {KIND_LABEL[node.kind]}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
