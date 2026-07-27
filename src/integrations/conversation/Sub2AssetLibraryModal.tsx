import { useEffect, useMemo, useState } from 'react'
import { ALL_FAVORITES_COLLECTION_ID, getTaskFavoriteCollectionIds, useStore } from '../../store'
import { CloseIcon } from '../../components/ui/icons'
import { ensureImageCached, ensureImageThumbnailCached, subscribeImageThumbnail } from '../../features/imageLibrary'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'

type Props = {
  open: boolean
  onClose: () => void
  /** 参考图数量上限（视频模式为 1） */
  limit: number
}

function AssetThumbnail({ imageId, onPick, added }: { imageId: string; onPick: () => void; added: boolean }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
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

  return (
    <button
      type="button"
      onClick={onPick}
      className={`group relative aspect-square overflow-hidden rounded-xl border transition ${added
        ? 'border-lime-400 ring-1 ring-lime-400/60'
        : 'border-gray-200 hover:border-gray-400 dark:border-white/10 dark:hover:border-white/30'
      }`}
      aria-label={added ? '已加入参考图' : '加入参考图'}
    >
      {dataUrl
        ? <img src={dataUrl} alt="" draggable={false} className="h-full w-full object-cover" />
        : <div className="h-full w-full animate-pulse bg-gray-100 dark:bg-white/5" />}
      <span className={`absolute inset-x-0 bottom-0 bg-black/60 py-1 text-center text-xs text-white transition-opacity ${added ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        {added ? '已加入' : '加入参考图'}
      </span>
    </button>
  )
}

/** 聊天输入框内的素材库：按素材集浏览已入库图片，点选加入参考图。 */
export default function Sub2AssetLibraryModal({ open, onClose, limit }: Props) {
  const tasks = useStore((s) => s.tasks)
  const favoriteCollections = useStore((s) => s.favoriteCollections)
  const inputImages = useStore((s) => s.inputImages)
  const showToast = useStore((s) => s.showToast)
  const [collectionId, setCollectionId] = useState(ALL_FAVORITES_COLLECTION_ID)
  useCloseOnEscape(open, onClose)

  const imageIds = useMemo(() => {
    const ids: string[] = []
    const seen = new Set<string>()
    for (const task of tasks) {
      if (!task.isFavorite) continue
      if (collectionId !== ALL_FAVORITES_COLLECTION_ID && !getTaskFavoriteCollectionIds(task).includes(collectionId)) continue
      for (const id of task.outputImages || []) {
        if (seen.has(id)) continue
        seen.add(id)
        ids.push(id)
      }
    }
    return ids
  }, [collectionId, tasks])

  if (!open) return null

  const addedIds = new Set(inputImages.map((image) => image.id))

  const pick = async (imageId: string) => {
    if (addedIds.has(imageId)) {
      showToast('该素材已在参考图中', 'info')
      return
    }
    if (inputImages.length >= limit) {
      showToast(`参考图数量已达上限（${limit} 张）`, 'error')
      return
    }
    const dataUrl = await ensureImageCached(imageId)
    if (!dataUrl) {
      showToast('素材原图不可用', 'error')
      return
    }
    useStore.getState().addInputImage({ id: imageId, dataUrl })
    showToast('已加入参考图', 'success')
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80svh] w-full max-w-3xl flex-col rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-[#151517]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-base font-semibold text-gray-950 dark:text-white">素材库</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭素材库"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/10 dark:hover:text-gray-200"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          点选素材加入参考图（{inputImages.length}/{limit}）；在画廊中把图片存入素材库即可在此使用。
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {[{ id: ALL_FAVORITES_COLLECTION_ID, name: '全部' }, ...favoriteCollections].map((collection) => (
            <button
              key={collection.id}
              type="button"
              onClick={() => setCollectionId(collection.id)}
              className={`rounded-full px-3 py-1.5 text-xs transition ${collectionId === collection.id
                ? 'bg-gray-950 text-white dark:bg-white dark:text-gray-950'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.14]'
              }`}
            >
              {collection.name}
            </button>
          ))}
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {imageIds.length === 0 ? (
            <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
              该素材集还没有图片，去画廊把生成结果存入素材库吧。
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {imageIds.map((imageId) => (
                <AssetThumbnail
                  key={imageId}
                  imageId={imageId}
                  added={addedIds.has(imageId)}
                  onPick={() => {
                    void pick(imageId)
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
