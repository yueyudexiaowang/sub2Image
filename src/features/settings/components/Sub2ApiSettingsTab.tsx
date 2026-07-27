import { useEffect, useState } from 'react'
import { useStore } from '../../../store'
import {
  getSub2Token,
  getSub2User,
  listSub2Groups,
  logoutSub2,
  OPEN_SUB2_CONNECT_EVENT,
  type Sub2Group,
  type Sub2User,
} from '../../../lib/sub2api'

export default function Sub2ApiSettingsTab() {
  const [user, setUser] = useState<Sub2User | null>(() => getSub2User())
  const [groups, setGroups] = useState<Sub2Group[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadGroups = async () => {
    setLoading(true)
    setError('')
    try {
      setGroups(await listSub2Groups())
    } catch (err) {
      console.error('[Sub2API] 获取用户分组失败', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (getSub2Token()) void loadGroups()
  }, [])

  if (!user) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">登录 Sub2API</h3>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">登录后读取当前账号的可用分组。</p>
        </div>
        <button
          type="button"
          onClick={() => {
            useStore.getState().setShowSettings(false)
            window.dispatchEvent(new Event(OPEN_SUB2_CONNECT_EVENT))
          }}
          className="w-full rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white"
        >
          登录我的贾维斯
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 border-b border-gray-200/70 pb-4 dark:border-white/[0.08]">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-800 dark:text-gray-100">已登录 Sub2API</div>
          <div className="truncate text-xs text-gray-500">{user.display_name || user.username || user.email || `用户 ${user.id || ''}`}</div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" disabled={loading} onClick={() => void loadGroups()} className="rounded-lg px-3 py-1.5 text-xs text-blue-500 hover:bg-blue-50 disabled:opacity-50 dark:hover:bg-blue-500/10">刷新分组</button>
          <button
            type="button"
            onClick={() => {
              logoutSub2()
              setUser(null)
              setGroups([])
              setError('')
            }}
            className="rounded-lg px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.06]"
          >
            退出
          </button>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">账号分组</h3>
        <p className="mt-1 text-xs text-gray-500">模型在 Agent 配置中分别选择。</p>
      </div>

      {groups.map((group) => (
        <div key={group.id} className="border-b border-gray-200/70 py-3 last:border-b-0 dark:border-white/[0.08]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{group.name}</span>
            {group.platform && <span className="text-[10px] font-medium uppercase text-gray-400">{group.platform}</span>}
          </div>
        </div>
      ))}

      {!loading && !groups.length && <div className="border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">当前账号没有可用分组。</div>}
      {loading && <div className="text-xs text-gray-500">正在读取账号分组...</div>}
      {error && <div className="border-l-2 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-300">{error}</div>}
    </div>
  )
}
