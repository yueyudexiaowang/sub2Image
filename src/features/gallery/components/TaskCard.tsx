import { useEffect, useState, useRef, type ReactNode } from 'react'
import type { TaskRecord } from '../../../types'
import { useStore, ensureImageThumbnailCached, subscribeImageThumbnail, retryTask } from '../../../store'
import { formatImageRatio } from '../../../lib/size'
import { getVideo } from '../../../lib/db'
import { CloudIcon } from '../../../components/ui/icons'
import ViewportTooltip from '../../../components/ui/ViewportTooltip'
import { saveTaskWithCloudState, useCloudTaskState } from '../../cloud'

interface Props {
  task: TaskRecord
  onReuse: () => void
  onEditOutputs: () => void
  onDelete: () => void
  onClick: (e: React.MouseEvent | React.TouchEvent) => void
  isSelected?: boolean
  disableSwipe?: boolean
  /** 按图片原始宽高比自适应卡片高度（用于 Agent 对话流全宽展示） */
  naturalAspect?: boolean
}

function TaskActionButton({
  tooltip,
  className,
  disabled = false,
  onClick,
  children,
}: {
  tooltip: string
  className: string
  disabled?: boolean
  onClick?: (e: React.MouseEvent) => void
  children: ReactNode
}) {
  const [tooltipVisible, setTooltipVisible] = useState(false)

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setTooltipVisible(true)}
      onMouseLeave={() => setTooltipVisible(false)}
      onFocus={() => setTooltipVisible(true)}
      onBlur={() => setTooltipVisible(false)}
    >
      <button
        type="button"
        onClick={onClick}
        className={className}
        disabled={disabled}
        aria-label={tooltip}
      >
        {children}
      </button>
      <ViewportTooltip visible={tooltipVisible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

export default function TaskCard({
  task,
  onReuse,
  onEditOutputs,
  onDelete,
  onClick,
  isSelected,
  disableSwipe,
  naturalAspect,
}: Props) {
  const [thumbs, setThumbs] = useState<Record<string, { src: string; ratio: string; size: string; w?: number; h?: number }>>({})
  const [thumbIndex, setThumbIndex] = useState(0)
  const [justRevealed, setJustRevealed] = useState(false)
  const prevStatusRef = useRef(task.status)
  const [now, setNow] = useState(Date.now())
  const [isSwiping, setIsSwiping] = useState(false)
  const [swipeStartedSelected, setSwipeStartedSelected] = useState(false)
  const [swipeActionActive, setSwipeActionActive] = useState(false)
  const [swipeDirection, setSwipeDirection] = useState<-1 | 0 | 1>(0)
  const [streamPreviewLoaded, setStreamPreviewLoaded] = useState(false)
  const [videoSrc, setVideoSrc] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const cardHoveredRef = useRef(false)
  const toggleTaskSelection = useStore((s) => s.toggleTaskSelection)
  const settings = useStore((s) => s.settings)
  const openFavoritePicker = useStore((s) => s.openFavoritePicker)
  const showToast = useStore((s) => s.showToast)
  const streamPreviewSrc = useStore((s) => s.streamPreviews[task.id] || '')
  const cloudState = useCloudTaskState(task.id)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const swipeResetTimerRef = useRef<number | null>(null)
  const suppressClickUntilRef = useRef(0)
  const horizontalSwipeRef = useRef(false)
  const swipeDirectionRef = useRef<-1 | 0 | 1>(0)
  const swipeActionActiveRef = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const swipeOffsetRef = useRef(0)
  const pendingSwipeOffsetRef = useRef(0)
  const swipeFrameRef = useRef<number | null>(null)

  const updateSwipeDirection = (nextDirection: -1 | 0 | 1) => {
    if (swipeDirectionRef.current === nextDirection) return
    swipeDirectionRef.current = nextDirection
    setSwipeDirection(nextDirection)
  }

  const updateSwipeActionActive = (nextActive: boolean) => {
    if (swipeActionActiveRef.current === nextActive) return
    swipeActionActiveRef.current = nextActive
    setSwipeActionActive(nextActive)
  }

  const applySwipeOffset = (offset: number) => {
    swipeOffsetRef.current = offset
    if (cardRef.current) {
      cardRef.current.style.transform = offset ? `translateX(${offset}px)` : ''
    }
  }

  const cancelSwipeFrame = () => {
    if (swipeFrameRef.current != null) {
      window.cancelAnimationFrame(swipeFrameRef.current)
      swipeFrameRef.current = null
    }
  }

  const scheduleSwipeOffset = (offset: number) => {
    if (swipeFrameRef.current == null && swipeOffsetRef.current === offset) return
    pendingSwipeOffsetRef.current = offset
    if (swipeFrameRef.current != null) return
    swipeFrameRef.current = window.requestAnimationFrame(() => {
      swipeFrameRef.current = null
      applySwipeOffset(pendingSwipeOffsetRef.current)
    })
  }

  const isTagScrollTarget = (target: EventTarget | null) => {
    return target instanceof Element && Boolean(target.closest('[data-tag-scroll-area]'))
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (disableSwipe || isTagScrollTarget(e.target)) {
      touchStartRef.current = null
      horizontalSwipeRef.current = false
      setIsSwiping(false)
      cancelSwipeFrame()
      applySwipeOffset(0)
      updateSwipeDirection(0)
      updateSwipeActionActive(false)
      return
    }

    if (swipeResetTimerRef.current != null) {
      window.clearTimeout(swipeResetTimerRef.current)
      swipeResetTimerRef.current = null
    }
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    horizontalSwipeRef.current = false
    setSwipeStartedSelected(Boolean(isSelected))
    updateSwipeActionActive(false)
    updateSwipeDirection(0)
    cancelSwipeFrame()
    applySwipeOffset(0)
    setIsSwiping(true)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isTagScrollTarget(e.target)) return
    if (!touchStartRef.current) return
    const deltaX = e.touches[0].clientX - touchStartRef.current.x
    const deltaY = e.touches[0].clientY - touchStartRef.current.y
    
    // 如果主要是水平滑动
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
      horizontalSwipeRef.current = true
      e.preventDefault()
      // 限制滑动距离，例如最大 60px
      const boundedOffset = Math.max(-60, Math.min(60, deltaX))
      const nextDirection = boundedOffset > 0 ? 1 : boundedOffset < 0 ? -1 : 0
      const nextActionActive = Math.abs(deltaX) >= 40
      scheduleSwipeOffset(boundedOffset)
      updateSwipeDirection(nextDirection)
      updateSwipeActionActive(nextActionActive)
    }
  }

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (isTagScrollTarget(e.target)) {
      touchStartRef.current = null
      horizontalSwipeRef.current = false
      setIsSwiping(false)
      cancelSwipeFrame()
      updateSwipeDirection(0)
      updateSwipeActionActive(false)
      return
    }

    setIsSwiping(false)
    cancelSwipeFrame()
    updateSwipeDirection(0)
    
    if (!touchStartRef.current) return
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x
    touchStartRef.current = null
    const isSwipeAction = horizontalSwipeRef.current && Math.abs(deltaX) > 40
    horizontalSwipeRef.current = false
    updateSwipeActionActive(isSwipeAction)
    swipeResetTimerRef.current = window.setTimeout(() => {
      updateSwipeActionActive(false)
      swipeResetTimerRef.current = null
    }, 220)

    // 如果是水平滑动，且垂直偏移较小，认为是滑动选择
    if (isSwipeAction) {
      suppressClickUntilRef.current = Date.now() + 350
      e.preventDefault()
      e.stopPropagation()
      toggleTaskSelection(task.id)
    }
  }

  const handleTouchCancel = () => {
    touchStartRef.current = null
    horizontalSwipeRef.current = false
    setIsSwiping(false)
    cancelSwipeFrame()
    updateSwipeDirection(0)
    updateSwipeActionActive(false)
  }

  useEffect(() => () => {
    if (swipeResetTimerRef.current != null) {
      window.clearTimeout(swipeResetTimerRef.current)
    }
    cancelSwipeFrame()
  }, [])

  useEffect(() => {
    if (!isSwiping) {
      applySwipeOffset(0)
    }
  }, [isSwiping])

  useEffect(() => {
    setStreamPreviewLoaded(false)
  }, [streamPreviewSrc, task.id])

  useEffect(() => {
    let cancelled = false
    let objectUrl = ''
    setVideoSrc('')
    const videoId = task.outputVideoIds?.[0]
    if (!videoId) return

    getVideo(videoId).then((video) => {
      if (cancelled || !video) return
      objectUrl = URL.createObjectURL(video.blob)
      setVideoSrc(objectUrl)
    }).catch(() => {})

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [task.outputVideoIds])

  useEffect(() => {
    if (!videoSrc || !cardHoveredRef.current) return
    void videoRef.current?.play().catch(() => {})
  }, [videoSrc])

  const handleCardMouseEnter = () => {
    cardHoveredRef.current = true
    void videoRef.current?.play().catch(() => {})
  }

  const handleCardMouseLeave = () => {
    cardHoveredRef.current = false
    videoRef.current?.pause()
  }

  // 定时更新运行中任务的计时
  useEffect(() => {
    if (task.status !== 'running' && !(task.status === 'error' && (task.falRecoverable || task.customRecoverable))) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    setNow(Date.now())
    return () => clearInterval(id)
  }, [task.customRecoverable, task.falRecoverable, task.status])

  // 加载所有输出图片的缩略图（支持叠放轮播）
  useEffect(() => {
    setThumbs({})
    setThumbIndex(0)

    let cancelled = false
    const imageIds = task.outputImages ?? []
    const unsubscribes: Array<() => void> = []

    for (const imageId of imageIds) {
      const applyThumbnail = (thumbnail: { dataUrl: string; width?: number; height?: number }) => {
        if (cancelled) return
        setThumbs((prev) => ({
          ...prev,
          [imageId]: {
            src: thumbnail.dataUrl,
            ratio: thumbnail.width && thumbnail.height ? formatImageRatio(thumbnail.width, thumbnail.height) : '',
            size: thumbnail.width && thumbnail.height ? `${thumbnail.width}×${thumbnail.height}` : '',
            w: thumbnail.width,
            h: thumbnail.height,
          },
        }))
      }

      unsubscribes.push(subscribeImageThumbnail(imageId, applyThumbnail))
      ensureImageThumbnailCached(imageId).then((thumbnail) => {
        if (cancelled || !thumbnail) return
        applyThumbnail(thumbnail)
      }).catch(() => {})
    }

    return () => {
      cancelled = true
      unsubscribes.forEach((fn) => fn())
    }
  }, [task.outputImages])

  // 从运行中变为完成时，播放揭示特效
  useEffect(() => {
    if (prevStatusRef.current === 'running' && task.status === 'done') {
      setJustRevealed(true)
      const timer = window.setTimeout(() => setJustRevealed(false), 1400)
      prevStatusRef.current = task.status
      return () => window.clearTimeout(timer)
    }
    prevStatusRef.current = task.status
  }, [task.status])

  const duration = (() => {
    let seconds: number
    if (task.status === 'running' || task.falRecoverable || task.customRecoverable) {
      seconds = Math.floor((now - task.createdAt) / 1000)
    } else if (task.elapsed != null) {
      seconds = Math.floor(task.elapsed / 1000)
    } else {
      return '00:00'
    }
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
    const ss = String(seconds % 60).padStart(2, '0')
    return `${mm}:${ss}`
  })()
  const showSwipeAction = swipeActionActive
  const isFalReconnecting = task.status === 'error' && task.falRecoverable
  const isCustomReconnecting = task.status === 'error' && task.customRecoverable
  const showRunningTimer = task.status === 'running' || isFalReconnecting || isCustomReconnecting
  const swipeBgClass = showSwipeAction
    ? swipeStartedSelected
      ? 'bg-gray-500 dark:bg-gray-600'
      : 'bg-blue-500'
    : 'bg-gray-200 dark:bg-gray-700'

  const outputErrorCount = task.outputErrors?.length ?? 0
  const outputSuccessCount = task.outputImages?.length ?? 0
  const requestedOutputCount = Math.max(task.params.n, outputSuccessCount + outputErrorCount)
  const hasPartialOutputFailure = task.status === 'done' && outputErrorCount > 0

  const outputImages = task.outputImages ?? []
  const currentImageId = outputImages[thumbIndex] || outputImages[0] || ''
  const currentThumb = currentImageId ? thumbs[currentImageId] : undefined
  const thumbSrc = currentThumb?.src || ''
  const coverRatio = currentThumb?.ratio || ''
  const coverSize = currentThumb?.size || ''
  // naturalAspect 模式下的宽高比：优先用真实图片尺寸，生成中回退到任务配置的尺寸
  const aspectDims = (() => {
    if (currentThumb?.w && currentThumb?.h) return { w: currentThumb.w, h: currentThumb.h }
    const m = task.params.size?.match(/^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/)
    if (m) return { w: Number(m[1]), h: Number(m[2]) }
    return null
  })()
  const canCycleThumbs = task.status === 'done' && outputImages.length > 1
  const cycleThumb = (delta: number) => {
    if (!outputImages.length) return
    setThumbIndex((i) => (i + delta + outputImages.length) % outputImages.length)
  }

  const isInterrupted = task.status === 'error' && task.error === '已停止生成。'

  return (
    <div className="relative rounded-xl">
      {/* 侧滑底图 */}
      <div
        className={`absolute inset-0 rounded-xl flex items-center transition-opacity duration-200 pointer-events-none ${
          isSwiping || swipeDirection !== 0 || swipeActionActive ? 'opacity-100' : 'opacity-0'
        } ${swipeBgClass} ${
          swipeDirection > 0 ? 'justify-start pl-6' : 'justify-end pr-6'
        }`}
      >
        <svg className={`w-8 h-8 transition-transform duration-150 ${showSwipeAction ? 'scale-110 text-white' : 'scale-90 text-white/60'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {swipeStartedSelected && showSwipeAction ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          )}
        </svg>
      </div>

      <div
        ref={cardRef}
        className={`group/card relative cursor-pointer touch-pan-y overflow-hidden rounded-xl border bg-sidebar duration-200 will-change-transform hover:shadow-lg dark:bg-gray-900 dark:hover:bg-gray-800/80 ${
          isSwiping ? '!bg-sidebar dark:!bg-gray-900' : ''
        } ${
          !isSwiping ? 'transition-[box-shadow,border-color,background-color,transform]' : 'transition-[box-shadow,border-color,background-color]'
        } ${
          task.status === 'running'
            ? 'border-blue-400 generating'
            : isSelected
            ? 'border-blue-500 shadow-md ring-2 ring-blue-500/50'
            : 'border-border hover:border-gray-400/80 dark:border-white/[0.08] dark:hover:border-white/[0.18]'
        }`}
        onMouseEnter={handleCardMouseEnter}
        onMouseLeave={handleCardMouseLeave}
        onClick={(e) => {
          if (Date.now() < suppressClickUntilRef.current) {
            e.preventDefault()
            e.stopPropagation()
            return
          }
          onClick(e)
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        draggable={task.status === 'done' && task.outputImages?.length > 0}
        onDragStart={(e) => {
          if (task.status !== 'done' || !task.outputImages?.length) return;
          const imageIds = task.outputImages;
          e.dataTransfer.setData('text/plain', `agent-images:${imageIds.join(',')}`);
          e.dataTransfer.effectAllowed = 'copy';
          // Optionally set drag image if we have thumbSrc
          if (thumbSrc) {
            const preview = document.createElement('div');
            preview.style.cssText = 'position:fixed;left:-1000px;top:-1000px;width:100px;height:100px;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.25);';
            const previewImg = document.createElement('img');
            previewImg.src = thumbSrc;
            previewImg.style.cssText = 'width:100px;height:100px;object-fit:cover;display:block;';
            preview.appendChild(previewImg);
            document.body.appendChild(preview);
            e.dataTransfer.setDragImage(preview, 50, 50);
            setTimeout(() => preview.remove(), 0);
          }
        }}
      >
        {/* 选中时的角标 */}
      {isSelected && (
        <div className="absolute top-2 right-2 z-10 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center shadow-sm">
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
      {cloudState && (
        <div className={`absolute top-2 z-10 ${isSelected ? 'right-9' : 'right-2'}`}>
          <TaskActionButton
            tooltip={cloudState.status === 'saving' ? '正在保存到云端' : cloudState.status === 'removing' ? '正在移出云端' : cloudState.status === 'saved' ? '已保存到云端' : '云端保存失败，点击重试'}
            disabled={cloudState.status !== 'error'}
            onClick={(e) => {
              e.stopPropagation()
              void saveTaskWithCloudState(task)
                .then(() => showToast('已保存到云端', 'success'))
                .catch((err) => showToast(err instanceof Error ? err.message : '云端保存失败', 'error'))
            }}
            className={`grid h-7 w-7 place-items-center rounded-full border border-white/20 bg-black/55 text-white shadow-sm backdrop-blur-sm ${cloudState.status === 'saving' || cloudState.status === 'removing' ? 'animate-pulse' : cloudState.status === 'error' ? '!text-red-300' : '!text-sky-300'}`}
          >
            <CloudIcon className="h-4 w-4" />
          </TaskActionButton>
        </div>
      )}
      <div
        className={naturalAspect && aspectDims ? 'max-h-[70vh] w-full' : 'h-40'}
        style={naturalAspect && aspectDims ? { aspectRatio: `${aspectDims.w} / ${aspectDims.h}` } : undefined}
      >
        {/* 图片区域：铺满整个卡片 */}
        <div className="h-full w-full bg-gray-100 dark:bg-black/20 relative flex items-center justify-center overflow-hidden">
          {task.status === 'running' && streamPreviewSrc && (
            <>
              <img
                src={streamPreviewSrc}
                className={`h-full w-full object-cover ${streamPreviewLoaded ? '' : 'hidden'}`}
                alt=""
                onLoad={() => setStreamPreviewLoaded(true)}
                onError={() => setStreamPreviewLoaded(false)}
              />
              {streamPreviewLoaded && (
                <span className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded bg-blue-500 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm sm:text-xs">
                  预览
                </span>
              )}
            </>
          )}
          {task.status === 'running' && (!streamPreviewSrc || !streamPreviewLoaded) && (
            <div className="task-gen-placeholder absolute inset-0" role="status" aria-label="生成中" />
          )}
          {task.status === 'error' && isFalReconnecting && (
            <div className="flex flex-col items-center gap-1 px-2">
              <svg
                className="w-7 h-7 text-yellow-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span className="text-xs text-yellow-500 text-center leading-tight">
                重连中
              </span>
            </div>
          )}
          {task.status === 'error' && !isFalReconnecting && (
            <div className="flex flex-col items-center gap-1 px-2">
              <svg
                className={`w-7 h-7 ${isInterrupted ? 'text-yellow-400' : 'text-red-400'}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className={`text-xs text-center leading-tight ${isInterrupted ? 'text-yellow-500' : 'text-red-400'}`}>
                {isInterrupted ? '已停止' : '失败'}
              </span>
            </div>
          )}
          {task.status === 'done' && (thumbSrc || videoSrc) && (
            <div className={`group/deck absolute inset-0 ${justRevealed ? 'task-reveal' : ''}`}>
              {canCycleThumbs && (
                <>
                  {/* 叠放层：露出后续图片的边缘 */}
                  {outputImages.length > 2 && (
                    <div className="absolute inset-x-4 top-0 h-3 overflow-hidden rounded-t-md opacity-50">
                      {thumbs[outputImages[(thumbIndex + 2) % outputImages.length]]?.src ? (
                        <img src={thumbs[outputImages[(thumbIndex + 2) % outputImages.length]]!.src} className="h-8 w-full object-cover" alt="" aria-hidden="true" />
                      ) : (
                        <div className="h-full w-full bg-gray-300 dark:bg-gray-600" />
                      )}
                    </div>
                  )}
                  <div className="absolute inset-x-2 top-[5px] h-4 overflow-hidden rounded-t-md opacity-75">
                    {thumbs[outputImages[(thumbIndex + 1) % outputImages.length]]?.src ? (
                      <img src={thumbs[outputImages[(thumbIndex + 1) % outputImages.length]]!.src} className="h-10 w-full object-cover" alt="" aria-hidden="true" />
                    ) : (
                      <div className="h-full w-full bg-gray-300 dark:bg-gray-600" />
                    )}
                  </div>
                </>
              )}
              <div className={`absolute inset-x-0 bottom-0 overflow-hidden ${canCycleThumbs ? 'top-[10px] rounded-t-lg shadow-[0_-2px_8px_rgba(0,0,0,0.25)]' : 'top-0'}`}>
                {videoSrc ? (
                  <video
                    ref={videoRef}
                    src={videoSrc}
                    poster={thumbSrc || undefined}
                    className="task-deck-img h-full w-full object-cover"
                    loop
                    muted
                    playsInline
                    preload="auto"
                    aria-label="生成视频预览"
                    onError={() => setVideoSrc('')}
                  />
                ) : (
                  <img
                    key={currentImageId}
                    src={thumbSrc}
                    data-image-id={currentImageId}
                    data-output-image-ids={task.outputImages.join(',')}
                    className="saveable-image task-deck-img h-full w-full object-cover"
                    loading="lazy"
                    alt=""
                  />
                )}
                {task.outputVideoIds?.length ? (
                  <span className="absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white backdrop-blur-sm" aria-label="视频">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  </span>
                ) : null}
              </div>
              {canCycleThumbs && (
                <>
                  <button
                    type="button"
                    className="absolute left-1 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur-sm transition hover:bg-black/70 group-hover/deck:opacity-100 focus-visible:opacity-100"
                    aria-label="上一张图片"
                    onClick={(e) => {
                      e.stopPropagation()
                      cycleThumb(-1)
                    }}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="absolute right-1 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur-sm transition hover:bg-black/70 group-hover/deck:opacity-100 focus-visible:opacity-100"
                    aria-label="下一张图片"
                    onClick={(e) => {
                      e.stopPropagation()
                      cycleThumb(1)
                    }}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </>
              )}
              {(hasPartialOutputFailure || outputImages.length > 1) && (
                <span className="absolute bottom-1 left-1 z-10 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white">
                  {hasPartialOutputFailure
                    ? <>{requestedOutputCount} | <span className="font-semibold text-yellow-300">{outputSuccessCount}</span></>
                    : `${thumbIndex + 1}/${outputImages.length}`}
                </span>
              )}
            </div>
          )}
          {task.status === 'done' && !thumbSrc && !videoSrc && (
            <svg
              className="w-8 h-8 text-gray-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          )}
          {/* 运行中显示耗时，完成后显示封面图比例与分辨率标签 */}
          <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
            {showRunningTimer || task.status !== 'done' || !coverRatio || !coverSize ? (
              <span className="flex items-center gap-1 bg-black/50 text-white text-[10px] sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-sm font-mono">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {duration}
              </span>
            ) : (
              <>
                <span className="bg-black/50 text-white text-[10px] sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-sm font-mono">
                  {coverRatio}
                </span>
                <span className="bg-black/50 text-white/90 text-[10px] sm:text-xs px-1.5 py-0.5 rounded backdrop-blur-sm font-medium">
                  {coverSize}
                </span>
              </>
            )}
          </div>
          {/* 悬停操作栏：叠放在图片底部 */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-center justify-end gap-0.5 bg-gradient-to-t from-black/70 via-black/35 to-transparent px-1.5 pb-1 pt-8 opacity-0 transition-opacity duration-150 group-hover/card:pointer-events-auto group-hover/card:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"
            onTouchStart={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            onTouchCancel={(e) => e.stopPropagation()}
          >
            {((task.status === 'error' && !isFalReconnecting) || settings.alwaysShowRetryButton) && (
              <TaskActionButton
                tooltip="重试任务"
                onClick={(e) => {
                  e.stopPropagation()
                  retryTask(task)
                }}
                className="p-1.5 rounded-md text-white/80 hover:text-blue-300 hover:bg-white/10 transition"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </TaskActionButton>
            )}
            <TaskActionButton
              tooltip={task.isFavorite ? '编辑素材集' : '存入素材库'}
              onClick={(e) => {
                e.stopPropagation()
                openFavoritePicker([task.id])
              }}
              className={`p-1.5 rounded-md transition hover:bg-white/10 ${
                task.isFavorite ? 'text-yellow-400' : 'text-white/80 hover:text-yellow-300'
              }`}
            >
              <svg
                className="w-4 h-4"
                fill={task.isFavorite ? 'currentColor' : 'none'}
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                />
              </svg>
            </TaskActionButton>
            {task.kind !== 'video' && (
              <TaskActionButton
                tooltip="复用配置"
                onClick={(e) => {
                  e.stopPropagation()
                  onReuse()
                }}
                className="p-1.5 rounded-md text-white/80 hover:text-blue-300 hover:bg-white/10 transition"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                  />
                </svg>
              </TaskActionButton>
            )}
            <TaskActionButton
              tooltip="编辑输出"
              onClick={(e) => {
                e.stopPropagation()
                onEditOutputs()
              }}
              className="p-1.5 rounded-md text-white/80 hover:text-green-300 hover:bg-white/10 transition disabled:opacity-30"
              disabled={!task.outputImages?.length || Boolean(task.outputVideoIds?.length)}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            </TaskActionButton>
            <TaskActionButton
              tooltip="删除任务"
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              className="p-1.5 rounded-md text-white/80 hover:text-red-300 hover:bg-white/10 transition"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </TaskActionButton>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
