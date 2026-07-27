import { useEffect, useState } from 'react'
import { useStore } from '../../../store'
import type { AppSettings } from '../../../types'
import {
  listSub2Groups,
  logoutSub2,
  OPEN_SUB2_CONNECT_EVENT,
  type Sub2Group,
} from '../../../lib/sub2api'
import { useSub2Auth } from '../../../hooks/useSub2Auth'
import { CloudIcon, RefreshIcon } from '../../../components/ui/icons'
import { refreshCloudAccount, useCloudRuntimeState } from '../../cloud'
import SettingToggleRow from './SettingToggleRow'

function formatCloudSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(0, Math.round(bytes / 1024))} KB`
}

interface Sub2ApiSettingsTabProps {
  settings: AppSettings
  commitSettings: (nextSettings: AppSettings) => void
}

export default function Sub2ApiSettingsTab({ settings, commitSettings }: Sub2ApiSettingsTabProps) {
  const { user, loggedIn } = useSub2Auth()
  const showToast = useStore((s) => s.showToast)
  const cloud = useCloudRuntimeState()
  const [groups, setGroups] = useState<Sub2Group[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadGroups = async (force = false) => {
    setLoading(true)
    setError('')
    try {
      setGroups(await listSub2Groups(force))
    } catch (err) {
      console.error('[Sub2API] 获取用户分组失败', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (loggedIn) void loadGroups()
    else {
      setGroups([])
      setError('')
    }
  }, [loggedIn])

  if (!loggedIn || !user) {
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
          <button type="button" disabled={loading} onClick={() => void loadGroups(true)} className="rounded-lg px-3 py-1.5 text-xs text-blue-500 hover:bg-blue-50 disabled:opacity-50 dark:hover:bg-blue-500/10">刷新分组</button>
          <button
            type="button"
            onClick={() => {
              useStore.getState().setConfirmDialog({
                title: '退出 Sub2API 登录',
                message: '退出后将无法刷新分组和切换模型，云端自动保存也会不可用；已保存的 Agent 模型配置会保留。确定退出吗？',
                action: () => {
                  logoutSub2()
                },
              })
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

      {!loading && !groups.length && <div role="status" className="border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">当前账号没有可用分组。</div>}
      {loading && <div role="status" className="text-xs text-gray-500">正在读取账号分组...</div>}
      {error && <div role="alert" className="border-l-2 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-300">{error}</div>}

      <div className="space-y-4 border-t border-gray-200/70 pt-4 dark:border-white/[0.08]">
        <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">云端</h3>

        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.02]">
          <SettingToggleRow
            label="自动保存新生成内容"
            description="开启后，新完成的图片、视频和新导入的 Skill 会保存到当前 Sub2API 账号。"
            checked={settings.cloudAutoSave}
            onToggle={() => commitSettings({ ...settings, cloudAutoSave: !settings.cloudAutoSave })}
          />
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.02]">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-2">
              <CloudIcon className="h-4 w-4 shrink-0 text-sky-500" />
              <h4 className="truncate text-sm font-bold text-gray-800 dark:text-gray-100">云端容量</h4>
            </div>
            <button
              type="button"
              disabled={cloud.syncing}
              onClick={() => {
                void refreshCloudAccount()
                  .then(() => showToast('云端容量已刷新', 'success'))
                  .catch((err) => showToast(err instanceof Error ? err.message : '刷新云端容量失败', 'error'))
              }}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:cursor-wait disabled:opacity-50 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              aria-label="刷新云端容量"
              title="刷新云端容量"
            >
              <RefreshIcon className={`h-4 w-4 ${cloud.syncing ? 'animate-spin' : ''}`} />
            </button>
          </div>
          {cloud.account ? (
            <>
              <div
                className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.07]"
                role="progressbar"
                aria-label="云端容量使用"
                aria-valuemin={0}
                aria-valuemax={cloud.account.quotaBytes}
                aria-valuenow={cloud.account.usedBytes}
              >
                <div
                  className="h-full rounded-full bg-sky-500 transition-[width]"
                  style={{ width: `${Math.min(100, cloud.account.quotaBytes > 0 ? cloud.account.usedBytes / cloud.account.quotaBytes * 100 : 0)}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between gap-4 text-xs text-gray-500 dark:text-gray-400">
                <span>已用 {formatCloudSize(cloud.account.usedBytes)}</span>
                <span>共 {formatCloudSize(cloud.account.quotaBytes)}</span>
              </div>
            </>
          ) : (
            <p role="status" className="mt-2 text-xs text-gray-500 dark:text-gray-400">正在读取容量信息...</p>
          )}
        </div>
      </div>
    </div>
  )
}
