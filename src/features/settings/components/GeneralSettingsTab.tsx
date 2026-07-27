import { useEffect, useState } from 'react'
import type { AppSettings } from '../../../types'
import Select from '../../../components/ui/Select'
import SettingToggleRow from './SettingToggleRow'

const IS_MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')
const COARSE_POINTER_QUERY = '(max-width: 639px)'

const canMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

/** 与 sm 断点一致的窄屏检测，替代渲染两套组件的 sm:hidden 方案。 */
function useIsNarrowScreen() {
  const [narrow, setNarrow] = useState(() => canMatchMedia() && window.matchMedia(COARSE_POINTER_QUERY).matches)
  useEffect(() => {
    if (!canMatchMedia()) return
    const media = window.matchMedia(COARSE_POINTER_QUERY)
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return narrow
}

interface GeneralSettingsTabProps {
  settings: AppSettings
  zipDownloadRouteSummary: string
  commitSettings: (nextSettings: AppSettings) => void
  onOpenZipDownloadRouteManager: () => void
  toggleTaskCompletionNotification: () => Promise<void>
}

export default function GeneralSettingsTab({
  settings,
  zipDownloadRouteSummary,
  commitSettings,
  onOpenZipDownloadRouteManager,
  toggleTaskCompletionNotification,
}: GeneralSettingsTabProps) {
  const isNarrowScreen = useIsNarrowScreen()
  const modifierLabel = IS_MAC ? '⌘ + Enter' : 'Ctrl + Enter'
  const submitOptions = isNarrowScreen
    ? [
        { label: '发送按钮', value: 'modifier' },
        { label: '回车/发送按钮', value: 'enter' },
      ]
    : [
        { label: modifierLabel, value: 'modifier' },
        { label: 'Enter', value: 'enter' },
      ]

  return (
    <div className="space-y-5">
      <section className="space-y-4 border-b border-gray-200/70 pb-5 dark:border-white/[0.08]">
        <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">外观</h3>
        <div className="block">
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="block text-sm text-gray-600 dark:text-gray-300">主题</span>
            <div className="w-28 shrink-0">
              <Select
                value={settings.theme}
                onChange={(val) => commitSettings({ ...settings, theme: val as AppSettings['theme'] })}
                ariaLabel="主题"
                options={[
                  { label: '跟随系统', value: 'system' },
                  { label: '黑色', value: 'dark' },
                  { label: '白色', value: 'light' },
                ]}
                className="w-full px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] text-xs transition-all duration-200 shadow-sm text-gray-700 dark:text-gray-200 outline-none"
              />
            </div>
          </div>
          <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
            跟随系统时会随设备外观自动切换，黑色或白色会始终保持所选主题。
          </div>
        </div>
      </section>

      <section className="space-y-4 border-b border-gray-200/70 pb-5 dark:border-white/[0.08]">
        <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">输入与提交</h3>
        <div className="block">
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="block text-sm text-gray-600 dark:text-gray-300">任务提交方式</span>
            <div className="w-28 shrink-0">
              <Select
                value={settings.enterSubmit ? 'enter' : 'modifier'}
                onChange={(val) => commitSettings({ ...settings, enterSubmit: val === 'enter' })}
                ariaLabel="任务提交方式"
                options={submitOptions}
                className="w-full px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] text-xs transition-all duration-200 shadow-sm text-gray-700 dark:text-gray-200 outline-none"
              />
            </div>
          </div>
          <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
            {isNarrowScreen
              ? '选择回车/发送按钮时，回车可提交；否则仅使用发送按钮提交。'
              : `选择 ${modifierLabel} 时，Enter 换行；选择 Enter 时，Shift + Enter 换行。`}
          </div>
        </div>
        <SettingToggleRow
          label="提交任务后清空输入框"
          description="开启后，提交成功创建任务时会清空提示词和参考图。"
          checked={settings.clearInputAfterSubmit}
          onToggle={() => commitSettings({ ...settings, clearInputAfterSubmit: !settings.clearInputAfterSubmit })}
        />
        <SettingToggleRow
          label="重启后加载上次的输入框"
          description="关闭后，不再持久化提示词和参考图，下次启动会使用空输入框。"
          checked={settings.persistInputOnRestart}
          onToggle={() => commitSettings({ ...settings, persistInputOnRestart: !settings.persistInputOnRestart })}
        />
      </section>

      <section className="space-y-4 border-b border-gray-200/70 pb-5 dark:border-white/[0.08]">
        <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">生成</h3>
        <div className="block">
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="block text-sm text-gray-600 dark:text-gray-300">参考图编辑按钮</span>
            <div className="w-28 shrink-0">
              <Select
                value={settings.referenceImageEditAction}
                onChange={(val) => commitSettings({ ...settings, referenceImageEditAction: val as AppSettings['referenceImageEditAction'] })}
                ariaLabel="参考图编辑按钮"
                options={[
                  { label: '询问', value: 'ask' },
                  { label: '替换参考图', value: 'replace-reference' },
                  { label: '添加遮罩', value: 'add-mask' },
                ]}
                className="w-full px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] text-xs transition-all duration-200 shadow-sm text-gray-700 dark:text-gray-200 outline-none"
              />
            </div>
          </div>
          <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
            控制未添加遮罩的参考图点击编辑按钮时，是每次询问、直接替换参考图，还是直接添加遮罩。
          </div>
        </div>
        <SettingToggleRow
          label="复用配置时临时复用该任务的 API 配置"
          description="开启后，复用历史任务时会临时使用该任务的 API 配置，找不到该配置时提交会提示；关闭后，会继续使用当前的 API 配置。"
          checked={settings.reuseTaskApiProfileTemporarily}
          onToggle={() => commitSettings({ ...settings, reuseTaskApiProfileTemporarily: !settings.reuseTaskApiProfileTemporarily })}
        />
        <SettingToggleRow
          label="成功任务仍然展示重试按钮"
          description="开启后，即使任务成功生成，也会在任务卡片和详情页显示重试按钮。"
          checked={settings.alwaysShowRetryButton}
          onToggle={() => commitSettings({ ...settings, alwaysShowRetryButton: !settings.alwaysShowRetryButton })}
        />
        <SettingToggleRow
          label="允许模型改写优化提示词"
          description="开启后，Codex CLI 兼容模式下的 Image API 请求和所有 Responses API 请求都不再附加防改写提示词，允许模型按服务商策略优化提示词。"
          checked={settings.allowPromptRewrite}
          onToggle={() => commitSettings({ ...settings, allowPromptRewrite: !settings.allowPromptRewrite })}
        />
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">下载与通知</h3>
        <div className="block">
          <div className="mb-1 flex items-center justify-between gap-3">
            <span className="block text-sm text-gray-600 dark:text-gray-300">使用压缩包进行的批量下载途径</span>
            <button
              type="button"
              onClick={onOpenZipDownloadRouteManager}
              className="shrink-0 rounded-xl border border-gray-200/80 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 hover:text-gray-900 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-gray-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
            >
              管理
            </button>
          </div>
          <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
            {zipDownloadRouteSummary}
          </div>
        </div>
        <SettingToggleRow
          label="任务完成后发送系统通知"
          description="开启后，画廊模式图像生成完成、对话模式回复结束时，会发送浏览器系统通知。浏览器可能会请求通知权限或默认拒绝，请查看相关提示。"
          checked={settings.taskCompletionNotification}
          onToggle={() => {
            void toggleTaskCompletionNotification()
          }}
        />
      </section>
    </div>
  )
}
