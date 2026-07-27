import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../../../store'
import { useTooltip } from '../../../hooks/useTooltip'
import { ChevronLeftIcon, CollectionManageIcon, FavoriteIcon } from '../../../components/ui/icons'
import ViewportTooltip from '../../../components/ui/ViewportTooltip'
import GalleryFilterButton from './GalleryFilterButton'

function SearchActionButton({
  tooltip,
  className,
  disabled = false,
  onClick,
  children,
}: {
  tooltip: string
  className: string
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const tooltipState = useTooltip()

  return (
    <span className="relative inline-flex" {...tooltipState.handlers}>
      <button
        type="button"
        onClick={() => {
          tooltipState.dismiss()
          if (disabled) return
          onClick()
        }}
        disabled={disabled}
        className={className}
        aria-label={tooltip}
      >
        {children}
      </button>
      <ViewportTooltip visible={tooltipState.visible} className="whitespace-nowrap">
        {tooltip}
      </ViewportTooltip>
    </span>
  )
}

export default function SearchBar() {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const setActiveFavoriteCollectionId = useStore((s) => s.setActiveFavoriteCollectionId)
  const openManageCollectionsModal = useStore((s) => s.openManageCollectionsModal)
  const inCollectionOverview = filterFavorite && !activeFavoriteCollectionId
  const favoriteTooltip = activeFavoriteCollectionId ? '返回素材库' : filterFavorite ? '退出素材库' : '素材库'
  const leftClass = `shrink-0 overflow-hidden transition-[max-width,margin,opacity,transform] duration-300 ease-out sm:mr-2 sm:max-w-10 sm:translate-x-0 sm:opacity-100 sm:pointer-events-auto ${focused
    ? 'mr-0 max-w-0 -translate-x-2 opacity-0 pointer-events-none'
    : 'mr-2 max-w-10 translate-x-0 opacity-100'
  }`
  useEffect(() => {
    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (document.activeElement !== inputRef.current) return

      const target = event.target instanceof Element ? event.target : document.elementFromPoint(event.clientX, event.clientY)
      if (!target) return
      if (rootRef.current?.contains(target)) return

      inputRef.current?.blur()
    }

    document.addEventListener('mousedown', handleDocumentMouseDown, true)
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown, true)
  }, [])

  const handleFavoriteClick = () => {
    if (activeFavoriteCollectionId) {
      setActiveFavoriteCollectionId(null)
      return
    }
    setFilterFavorite(!filterFavorite)
  }

  return (
    <>
      <div ref={rootRef} data-no-drag-select className="mt-6 mb-4 flex min-w-0 flex-nowrap items-center xl:hidden">
        <div className={leftClass}>
          <SearchActionButton
            tooltip={favoriteTooltip}
            onClick={handleFavoriteClick}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-colors ${
              filterFavorite
                ? 'border-yellow-400 bg-yellow-50 text-yellow-500 dark:bg-yellow-500/10'
                : 'border-border bg-sidebar text-gray-400 hover:bg-muted dark:border-white/[0.08] dark:bg-gray-900 dark:hover:bg-white/[0.06]'
            }`}
          >
            {activeFavoriteCollectionId ? <ChevronLeftIcon className="h-5 w-5" /> : <FavoriteIcon filled={filterFavorite} className="h-5 w-5" />}
          </SearchActionButton>
        </div>
        {inCollectionOverview && (
          <div className={leftClass}>
            <SearchActionButton
              tooltip="管理素材集"
              onClick={openManageCollectionsModal}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-sidebar text-gray-400 transition-colors hover:bg-muted dark:border-white/[0.08] dark:bg-gray-900 dark:hover:bg-white/[0.06]"
            >
              <CollectionManageIcon className="h-5 w-5" />
            </SearchActionButton>
          </div>
        )}
        <div className={leftClass}>
          <GalleryFilterButton />
        </div>
        <div className="relative z-10 min-w-0 flex-1 transition-[flex-basis,width] duration-300 ease-out">
            <svg
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              ref={inputRef}
              value={searchQuery}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') inputRef.current?.blur()
              }}
              type="text"
              placeholder={inCollectionOverview ? '搜索素材集名称...' : '搜索提示词、参数...'}
              className="h-10 w-full rounded-full border border-border bg-sidebar pl-10 pr-3 text-sm transition-[border-color,box-shadow,background-color] duration-300 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:border-white/[0.08] dark:bg-gray-900"
            />
        </div>
      </div>
    </>
  )
}
