import { useEffect, useRef, useState } from 'react'
import {
  ALL_FAVORITES_COLLECTION_ID,
  clearFailedTasks,
  getTaskFavoriteCollectionIds,
  taskMatchesFilterStatus,
  taskMatchesSearchQuery,
  useStore,
} from '../../../store'
import { FilterIcon, TrashIcon } from '../../../components/ui/icons'

const statusOptions = [
  { value: 'all', label: '全部任务' },
  { value: 'done', label: '已完成' },
  { value: 'running', label: '生成中' },
  { value: 'error', label: '失败' },
] as const

const buttonClass = 'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-sidebar text-gray-500 transition-colors hover:bg-muted hover:text-gray-900 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.07] dark:hover:text-gray-100'

export default function GalleryFilterButton() {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const filterStatus = useStore((s) => s.filterStatus)
  const setFilterStatus = useStore((s) => s.setFilterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const filterCloud = useStore((s) => s.filterCloud)
  const setFilterCloud = useStore((s) => s.setFilterCloud)
  const clearSelection = useStore((s) => s.clearSelection)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const filterCount = Number(filterStatus !== 'all') + Number(filterFavorite) + Number(filterCloud)
  const failedCount = useStore((s) => {
    const query = s.searchQuery.trim().toLowerCase()
    return s.tasks.filter((task) => {
      if (!taskMatchesFilterStatus(task, 'error')) return false
      if (s.filterFavorite) {
        if (!task.isFavorite) return false
        if (s.activeFavoriteCollectionId && s.activeFavoriteCollectionId !== ALL_FAVORITES_COLLECTION_ID && !getTaskFavoriteCollectionIds(task).includes(s.activeFavoriteCollectionId)) return false
      }
      return taskMatchesSearchQuery(task, query)
    }).length
  })

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') setOpen(false)
        return
      }
      if (rootRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  const handleStatusChange = (status: typeof filterStatus) => {
    if (status === filterStatus) return
    setFilterStatus(status)
    clearSelection()
  }

  const handleClearFailed = () => {
    const state = useStore.getState()
    const query = state.searchQuery.trim().toLowerCase()
    const ids = state.tasks
      .filter((task) => {
        if (!taskMatchesFilterStatus(task, 'error')) return false
        if (state.filterFavorite) {
          if (!task.isFavorite) return false
          if (state.activeFavoriteCollectionId && state.activeFavoriteCollectionId !== ALL_FAVORITES_COLLECTION_ID && !getTaskFavoriteCollectionIds(task).includes(state.activeFavoriteCollectionId)) return false
        }
        return taskMatchesSearchQuery(task, query)
      })
      .map((task) => task.id)
    if (!ids.length) return

    setOpen(false)
    setConfirmDialog({
      title: '清除失败记录',
      message: `确定清除筛选范围内的失败记录吗？\n纯失败任务会被删除；部分失败任务只会清除失败标记，保留已成功图片。共 ${ids.length} 条记录。`,
      confirmText: '清除',
      cancelText: '取消',
      tone: 'danger',
      action: () => clearFailedTasks(ids),
    })
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-label="筛选条件"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="筛选条件"
        onClick={() => setOpen((value) => !value)}
        className={`${buttonClass} ${open || filterCount > 0 ? '!bg-gray-200 !text-gray-900 dark:!bg-white/[0.12] dark:!text-white' : ''}`}
      >
        <FilterIcon className="h-5 w-5" />
        {filterCount > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-blue-500 ring-2 ring-sidebar dark:ring-gray-900" />}
      </button>

      {open && (
        <div role="dialog" aria-label="筛选条件面板" className="animate-modal-in fixed left-4 right-4 top-[calc(var(--app-header-height,4rem)+4.75rem)] z-50 max-h-[calc(100dvh-var(--app-header-height,4rem)-6rem)] overflow-y-auto rounded-lg border border-border bg-sidebar text-left shadow-2xl dark:border-white/[0.1] dark:bg-[#151516] sm:left-[calc(50%-210px)] sm:right-auto sm:w-[420px] xl:absolute xl:left-auto xl:right-0 xl:top-[calc(100%+0.75rem)] xl:max-h-none xl:overflow-hidden">
          <div className="flex h-14 items-center gap-3 border-b border-border px-5 dark:border-white/[0.1]">
            <FilterIcon className="h-5 w-5 text-gray-500 dark:text-gray-300" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">筛选条件</h2>
          </div>
          <div className="grid grid-cols-2 gap-8 p-5">
            <section>
              <h3 className="mb-3 text-xs font-medium text-gray-400">任务状态</h3>
              <div className="space-y-1">
                {statusOptions.map((option) => {
                  const active = filterStatus === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => handleStatusChange(option.value)}
                      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm text-gray-700 transition-colors hover:bg-muted dark:text-gray-200 dark:hover:bg-white/[0.06]"
                    >
                      <span className={`flex h-4 w-4 items-center justify-center rounded-sm border ${active ? 'border-gray-800 bg-gray-800 dark:border-gray-100 dark:bg-gray-100' : 'border-gray-400 dark:border-gray-500'}`}>
                        {active && <span className="h-1.5 w-1.5 rounded-[1px] bg-white dark:bg-gray-900" />}
                      </span>
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </section>

            <section>
              <h3 className="mb-3 text-xs font-medium text-gray-400">素材与云端</h3>
              <button
                type="button"
                aria-pressed={filterFavorite}
                onClick={() => setFilterFavorite(!filterFavorite)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm text-gray-700 transition-colors hover:bg-muted dark:text-gray-200 dark:hover:bg-white/[0.06]"
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded-sm border ${filterFavorite ? 'border-yellow-500 bg-yellow-500' : 'border-gray-400 dark:border-gray-500'}`}>
                  {filterFavorite && <span className="h-1.5 w-1.5 rounded-[1px] bg-white" />}
                </span>
                仅看素材
              </button>
              <button
                type="button"
                aria-pressed={filterCloud}
                onClick={() => setFilterCloud(!filterCloud)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-sm text-gray-700 transition-colors hover:bg-muted dark:text-gray-200 dark:hover:bg-white/[0.06]"
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded-sm border ${filterCloud ? 'border-sky-500 bg-sky-500' : 'border-gray-400 dark:border-gray-500'}`}>
                  {filterCloud && <span className="h-1.5 w-1.5 rounded-[1px] bg-white" />}
                </span>
                仅看云端
              </button>
              {filterStatus === 'error' && (
                <button
                  type="button"
                  disabled={failedCount === 0}
                  onClick={handleClearFailed}
                  className="mt-4 flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/[0.1] dark:text-gray-300 dark:hover:bg-white/[0.06]"
                >
                  <TrashIcon className="h-4 w-4" />
                  清除失败记录
                </button>
              )}
            </section>
          </div>
          {filterCount > 0 && (
            <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-gray-500 dark:border-white/[0.1] dark:text-gray-400">
              <span>已启用 {filterCount} 个条件</span>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-gray-700 transition-colors hover:bg-muted dark:text-gray-200 dark:hover:bg-white/[0.06]"
                onClick={() => {
                  setFilterStatus('all')
                  setFilterFavorite(false)
                  setFilterCloud(false)
                  clearSelection()
                }}
              >
                重置
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
