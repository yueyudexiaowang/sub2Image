import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../../store'
import { navigateToExtensionWorkspace } from '../../../ExtensionWorkspace'
import {
  ChevronLeftIcon,
  CloseIcon,
  CodeIcon,
  CollectionManageIcon,
  FavoriteIcon,
  SearchIcon,
} from '../../../components/ui/icons'
import GalleryFilterButton from './GalleryFilterButton'

type Props = {
  focused: boolean
  onFocusChange: (focused: boolean) => void
}

const iconButtonClass = 'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-sidebar text-gray-500 transition-colors hover:bg-muted hover:text-gray-900 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.07] dark:hover:text-gray-100'

export default function GalleryHeaderControls({ focused, onFocusChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const setActiveFavoriteCollectionId = useStore((s) => s.setActiveFavoriteCollectionId)
  const openManageCollectionsModal = useStore((s) => s.openManageCollectionsModal)
  const inCollectionOverview = filterFavorite && !activeFavoriteCollectionId
  const favoriteLabel = activeFavoriteCollectionId ? '返回素材库' : filterFavorite ? '退出素材库' : '素材库'

  useEffect(() => {
    const blurSearch = (e: MouseEvent) => {
      if (document.activeElement !== inputRef.current) return
      if (rootRef.current?.contains(e.target as Node)) return
      inputRef.current?.blur()
    }
    document.addEventListener('mousedown', blurSearch, true)
    return () => document.removeEventListener('mousedown', blurSearch, true)
  }, [])

  const handleFavoriteClick = () => {
    if (activeFavoriteCollectionId) {
      setActiveFavoriteCollectionId(null)
      return
    }
    setFilterFavorite(!filterFavorite)
  }

  const leftClass = `flex shrink-0 items-center gap-2 overflow-hidden transition-all duration-300 ease-out ${focused
    ? 'max-w-0 -translate-x-2 opacity-0 pointer-events-none'
    : 'max-w-[160px] translate-x-0 opacity-100'
  }`

  return (
    <>
      <div ref={rootRef} data-gallery-header-controls className="hidden min-w-0 flex-1 items-center justify-center gap-2 xl:flex">
        <div className={leftClass}>
          <button type="button" className={iconButtonClass} aria-label="打开拓展工作区" title="拓展工作区" onClick={() => navigateToExtensionWorkspace()}>
            <CodeIcon className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label={favoriteLabel}
            title={favoriteLabel}
            onClick={handleFavoriteClick}
            className={`${iconButtonClass} ${filterFavorite ? '!border-yellow-400 !bg-yellow-50 !text-yellow-500 dark:!bg-yellow-500/10' : ''}`}
          >
            {activeFavoriteCollectionId ? <ChevronLeftIcon className="h-5 w-5" /> : <FavoriteIcon filled={filterFavorite} className="h-5 w-5" />}
          </button>
          {inCollectionOverview && (
            <button type="button" className={iconButtonClass} aria-label="管理素材集" title="管理素材集" onClick={openManageCollectionsModal}>
              <CollectionManageIcon className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className={`relative min-w-0 transition-all duration-300 ease-out ${focused ? 'flex-1' : 'w-[clamp(280px,30vw,420px)] flex-none'}`}>
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            aria-label="搜索提示词和参数"
            placeholder={inCollectionOverview ? '搜索素材集名称...' : '搜索提示词、参数...'}
            onFocus={() => onFocusChange(true)}
            onBlur={() => onFocusChange(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') inputRef.current?.blur()
            }}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-10 w-full rounded-full border border-border bg-sidebar pl-12 pr-10 text-sm text-gray-900 outline-none transition-[border-color,box-shadow,background-color] duration-300 placeholder:text-gray-400 focus:border-gray-400 focus:bg-white focus:shadow-[0_0_0_3px_rgba(113,128,150,0.16)] dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-100 dark:focus:border-white/[0.2] dark:focus:bg-gray-900"
          />
          {searchQuery && focused && (
            <button
              type="button"
              aria-label="清空搜索"
              title="清空搜索"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-white/[0.07] dark:hover:text-gray-200"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <GalleryFilterButton />
        </div>
      </div>
    </>
  )
}
