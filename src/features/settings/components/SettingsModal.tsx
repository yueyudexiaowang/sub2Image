import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { normalizeBaseUrl } from '../../../lib/devProxy'
import { isApiProxyAvailable, isApiProxyLocked, readClientDevProxyConfig } from '../../../lib/devProxy'
import { useStore, exportData, importData, clearData, type SettingsTab } from '../../../store'
import {
  createDefaultOpenAIProfile,
  DEFAULT_FAL_BASE_URL,
  DEFAULT_FAL_MODEL,
  DEFAULT_IMAGES_MODEL,
  DEFAULT_OPENAI_PROFILE_ID,
  DEFAULT_RESPONSES_MODEL,
  DEFAULT_SETTINGS,
  isOpenAICompatibleProvider,
  normalizeAgentMaxToolRounds,
  normalizeSettings,
  normalizeStreamPartialImages,
} from '../../../lib/apiProfiles'
import { requestBrowserNotificationPermission, type BrowserNotificationPermissionResult } from '../../../lib/browserNotification'
import { DEFAULT_AGENT_MAX_TOOL_ROUNDS, DEFAULT_STREAM_PARTIAL_IMAGES, type ApiProfile, type AppSettings, type CustomProviderDefinition, type ZipDownloadRoute } from '../../../types'
import { useCloseOnEscape } from '../../../hooks/useCloseOnEscape'
import { useFocusTrap } from '../../../hooks/useFocusTrap'
import { usePreventBackgroundScroll } from '../../../hooks/usePreventBackgroundScroll'
import { Checkbox } from '../../../components/ui/Checkbox'
import { CloseIcon, TrashIcon, ExportIcon, ImportIcon } from '../../../components/ui/icons'
import GeneralSettingsTab from './GeneralSettingsTab'
import AgentSettingsTab from './AgentSettingsTab'
import Sub2ApiSettingsTab from './Sub2ApiSettingsTab'

function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

const ZIP_DOWNLOAD_ROUTE_OPTIONS: Array<{ route: ZipDownloadRoute; label: string; description: string }> = [
  { route: 'task-selection', label: '任务列表 > 多选', description: '主页或素材集详情中框选、Ctrl/⌘ 点选或移动端滑动选中任务后的“下载选中”。' },
  { route: 'favorite-collection-selection', label: '素材集列表 > 多选', description: '素材库概览页选中一个或多个素材集后的“下载选中”。' },
  { route: 'image-context-menu-all', label: '图片右键菜单 > 下载全部', description: '右键图片时下载同一组输出图片。' },
  { route: 'task-detail-all', label: '任务详情 > 下载全部', description: '任务详情弹窗中下载当前任务的所有输出图。' },
  { route: 'task-detail-partial', label: '任务详情 > 下载中间步骤图', description: '任务详情弹窗中下载流式生成保留的中间步骤图。' },
  { route: 'agent-round-all', label: 'Agent 对话轮次 > 下载所有图片', description: 'Agent 对话中下载某轮回复关联的全部图片。' },
]

const SETTINGS_TABS: Array<{ key: SettingsTab; label: string; icon: React.ReactNode }> = [
  {
    key: 'general',
    label: '习惯配置',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
      </svg>
    ),
  },
  {
    key: 'agent',
    label: 'Agent 配置',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8V4H8" />
        <rect width="16" height="12" x="4" y="8" rx="2" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2 14h2M20 14h2M15 13v2M9 13v2" />
      </svg>
    ),
  },
  {
    key: 'sub2api',
    label: 'Sub2API',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v18m6-15H9a3 3 0 000 6h6a3 3 0 010 6H6" />
      </svg>
    ),
  },
  {
    key: 'data',
    label: '数据管理',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
      </svg>
    ),
  },
]

function isAsyncCustomProvider(provider: CustomProviderDefinition | null | undefined) {
  return Boolean(provider?.poll || provider?.submit.taskIdPath || provider?.editSubmit?.taskIdPath)
}

function isProfileApiProxyEligible(settings: AppSettings, profile: ApiProfile) {
  if (!isOpenAICompatibleProvider(settings, profile.provider)) return false
  const customProvider = settings.customProviders.find((provider) => provider.id === profile.provider)
  return !isAsyncCustomProvider(customProvider)
}

export default function SettingsModal() {
  const showSettings = useStore((s) => s.showSettings)
  const settingsTabRequest = useStore((s) => s.settingsTabRequest)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const clearSettingsTabRequest = useStore((s) => s.clearSettingsTabRequest)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const showToast = useStore((s) => s.showToast)
  const importInputRef = useRef<HTMLInputElement>(null)
  const settingsScrollBoundaryRef = useRef<HTMLDivElement>(null)
  const zipDownloadRouteScrollBoundaryRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const tabListRef = useRef<HTMLElement>(null)

  // 仅输入框类字段保留本地缓冲；其余设置直接读写 store，避免弹窗打开期间外部改动被旧副本覆盖
  const [agentMaxToolRoundsInput, setAgentMaxToolRoundsInput] = useState(String(settings.agentMaxToolRounds))
  const [showZipDownloadRouteManager, setShowZipDownloadRouteManager] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsTab>('sub2api')
  const [exportConfig, setExportConfig] = useState(true)
  const [exportTasks, setExportTasks] = useState(true)
  const [exportPromptProjects, setExportPromptProjects] = useState(true)
  const [importConfig, setImportConfig] = useState(true)
  const [importTasks, setImportTasks] = useState(true)
  const [importPromptProjects, setImportPromptProjects] = useState(true)
  const [clearConfig, setClearConfig] = useState(true)
  const [clearTasks, setClearTasks] = useState(true)
  const [clearPromptProjects, setClearPromptProjects] = useState(true)
  const [isExportingData, setIsExportingData] = useState(false)
  const [isImportingData, setIsImportingData] = useState(false)
  const [isClearingData, setIsClearingData] = useState(false)

  const apiProxyConfig = readClientDevProxyConfig()
  const apiProxyAvailable = isApiProxyAvailable(apiProxyConfig)
  const apiProxyLocked = isApiProxyLocked(apiProxyConfig)

  const getDefaultModelForMode = (apiMode: AppSettings['apiMode']) =>
    apiMode === 'responses' ? DEFAULT_RESPONSES_MODEL : DEFAULT_IMAGES_MODEL

  const enabledZipDownloadRouteCount = ZIP_DOWNLOAD_ROUTE_OPTIONS
    .filter((option) => settings.zipDownloadRoutes.includes(option.route))
    .length

  const zipDownloadRouteSummary = enabledZipDownloadRouteCount
    ? `已开启 ${enabledZipDownloadRouteCount} 项使用压缩包进行批量下载的途径`
    : '未开启任何使用压缩包进行批量下载的途径'

  const wasSettingsOpenRef = useRef(false)

  useEffect(() => {
    if (!showSettings) {
      wasSettingsOpenRef.current = false
      return
    }
    if (wasSettingsOpenRef.current) return
    wasSettingsOpenRef.current = true
    setAgentMaxToolRoundsInput(String(settings.agentMaxToolRounds))
  }, [showSettings, settings.agentMaxToolRounds])

  useEffect(() => {
    if (!showSettings || !settingsTabRequest) return
    setActiveTab(settingsTabRequest)
    // 消费后立即清空，保证下次同名请求也能触发切换
    clearSettingsTabRequest()
  }, [clearSettingsTabRequest, settingsTabRequest, showSettings])

  const commitSettings = (nextSettings: AppSettings) => {
    const normalizedProfiles = nextSettings.profiles.map((profile) => {
      const nextApiProxy = isProfileApiProxyEligible(nextSettings, profile) && apiProxyAvailable ? (apiProxyLocked || profile.apiProxy) : false
      const shouldKeepEmptyBaseUrl = profile.provider !== 'fal' && nextApiProxy && !profile.baseUrl.trim()
      const normalizedBaseUrl = profile.provider === 'fal'
        ? profile.baseUrl.trim().replace(/\/+$/, '') || DEFAULT_FAL_BASE_URL
        : shouldKeepEmptyBaseUrl ? '' : normalizeBaseUrl(profile.baseUrl.trim() || DEFAULT_SETTINGS.baseUrl)
      const defaultModel = profile.provider === 'fal' ? DEFAULT_FAL_MODEL : getDefaultModelForMode(profile.apiMode)
      return {
        ...profile,
        name: profile.name.trim() || (profile.id === DEFAULT_OPENAI_PROFILE_ID ? '默认' : '新配置'),
        baseUrl: normalizedBaseUrl,
        model: profile.model.trim() || defaultModel,
        timeout: Number(profile.timeout) || DEFAULT_SETTINGS.timeout,
        apiProxy: nextApiProxy,
        codexCli: profile.provider === 'openai' ? profile.codexCli : false,
        streamImages: profile.provider === 'openai' ? profile.streamImages : false,
        streamPartialImages: profile.provider === 'openai' ? normalizeStreamPartialImages(profile.streamPartialImages) : DEFAULT_STREAM_PARTIAL_IMAGES,
      }
    })
    const fallbackProfile = createDefaultOpenAIProfile({ id: newId('openai') })
    const normalized = normalizeSettings({
      ...nextSettings,
      profiles: normalizedProfiles.length ? normalizedProfiles : [fallbackProfile],
      activeProfileId: normalizedProfiles.some((profile) => profile.id === nextSettings.activeProfileId)
        ? nextSettings.activeProfileId
        : (normalizedProfiles[0]?.id ?? fallbackProfile.id),
    })
    setSettings(normalized)
  }

  const setZipDownloadRouteEnabled = (route: ZipDownloadRoute, enabled: boolean) => {
    const nextRoutes = enabled
      ? Array.from(new Set([...settings.zipDownloadRoutes, route]))
      : settings.zipDownloadRoutes.filter((item) => item !== route)
    commitSettings({ ...settings, zipDownloadRoutes: nextRoutes })
  }

  const handleClose = () => {
    if (showZipDownloadRouteManager) {
      setShowZipDownloadRouteManager(false)
      return
    }
    const normalizedAgentMaxToolRounds = agentMaxToolRoundsInput.trim() === ''
      ? DEFAULT_AGENT_MAX_TOOL_ROUNDS
      : normalizeAgentMaxToolRounds(agentMaxToolRoundsInput, settings.agentMaxToolRounds)
    setAgentMaxToolRoundsInput(String(normalizedAgentMaxToolRounds))
    // 其余设置均为即时提交，这里只需处理仍在输入框缓冲的字段，未变化时不触发写盘
    if (normalizedAgentMaxToolRounds !== settings.agentMaxToolRounds) {
      commitSettings({ ...settings, agentMaxToolRounds: normalizedAgentMaxToolRounds })
    }
    setShowSettings(false)
  }

  const commitAgentMaxToolRounds = useCallback(() => {
    const value = agentMaxToolRoundsInput.trim() === ''
      ? DEFAULT_AGENT_MAX_TOOL_ROUNDS
      : normalizeAgentMaxToolRounds(agentMaxToolRoundsInput, settings.agentMaxToolRounds)
    setAgentMaxToolRoundsInput(String(value))
    if (value !== settings.agentMaxToolRounds) commitSettings({ ...settings, agentMaxToolRounds: value })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentMaxToolRoundsInput, settings])

  const showNotificationPermissionMessage = (result: Exclude<BrowserNotificationPermissionResult, { ok: true }>) => {
    if (result.reason === 'unsupported') {
      showToast('当前浏览器不支持系统通知', 'error')
    } else if (result.reason === 'insecure') {
      showToast('系统通知需要 HTTPS 或 localhost 安全上下文', 'error')
    } else if (result.reason === 'denied') {
      showToast('通知权限已被浏览器拒绝，请在地址栏左侧的网站设置中手动开启', 'error')
    } else {
      showToast('没有开启系统通知', 'info')
    }
  }

  const toggleTaskCompletionNotification = async () => {
    const current = useStore.getState().settings
    if (current.taskCompletionNotification) {
      commitSettings({ ...current, taskCompletionNotification: false })
      return
    }

    const result = await requestBrowserNotificationPermission()
    if (result.ok) {
      commitSettings({ ...useStore.getState().settings, taskCompletionNotification: true })
      showToast('任务完成通知已开启', 'success')
    } else {
      showNotificationPermissionMessage(result)
    }
  }

  const handleTabListKeyDown = (event: React.KeyboardEvent) => {
    const keys = SETTINGS_TABS.map((tab) => tab.key)
    const currentIndex = keys.indexOf(activeTab)
    let nextIndex = -1
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % keys.length
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + keys.length) % keys.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = keys.length - 1
    if (nextIndex < 0) return
    event.preventDefault()
    const nextKey = keys[nextIndex]
    setActiveTab(nextKey)
    tabListRef.current?.querySelector<HTMLElement>(`#settings-tab-${nextKey}`)?.focus()
  }

  useCloseOnEscape(showSettings, handleClose)
  usePreventBackgroundScroll(showSettings, showZipDownloadRouteManager ? zipDownloadRouteScrollBoundaryRef : settingsScrollBoundaryRef)
  // 子弹窗（portal 到 body）打开期间暂停主弹窗的焦点陷阱
  useFocusTrap(showSettings && !showZipDownloadRouteManager, dialogRef)

  if (!showSettings) return null

  const handleExport = async () => {
    setIsExportingData(true)
    try {
      await exportData({ exportConfig, exportTasks, exportPromptProjects })
    } finally {
      setIsExportingData(false)
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setIsImportingData(true)
      try {
        await importData(file, { importConfig, importTasks, importPromptProjects })
      } finally {
        setIsImportingData(false)
      }
    }
    e.target.value = ''
  }

  const handleClearAllData = async () => {
    if (isClearingData) return
    setIsClearingData(true)
    try {
      await clearData({ clearConfig, clearTasks, clearPromptProjects })
      showToast('所选数据已清空', 'success')
    } catch (err) {
      console.error('[数据管理] 清空数据失败', err)
      showToast(err instanceof Error ? err.message : '清空数据失败', 'error')
    } finally {
      setIsClearingData(false)
    }
  }

  return (
        <div data-no-drag-select className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in"
        onClick={handleClose}
      />
      <div
        ref={(node) => {
          settingsScrollBoundaryRef.current = node
          dialogRef.current = node
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        tabIndex={-1}
        className="metal-3d-surface relative z-10 flex h-[85dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-sidebar/95 outline-none animate-modal-in dark:bg-gray-900/95 sm:h-[600px]"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border/70 p-5 dark:border-white/[0.08]">
          <h3 id="settings-modal-title" className="text-lg font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            设置
          </h3>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400 dark:text-gray-500 font-mono select-none">v{__APP_VERSION__}</span>
            <button
              onClick={handleClose}
              className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
              aria-label="关闭"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 flex-col sm:flex-row">
          {/* Sidebar */}
          <div className="flex w-full shrink-0 flex-col border-b border-border/70 bg-background/60 dark:border-white/[0.08] dark:bg-white/[0.02] sm:w-48 sm:border-b-0 sm:border-r">
            <nav
              ref={tabListRef}
              role="tablist"
              aria-label="设置分类"
              onKeyDown={handleTabListKeyDown}
              className="flex-1 overflow-x-auto sm:overflow-y-auto custom-scrollbar p-3 space-x-1 sm:space-x-0 sm:space-y-1 flex sm:flex-col"
            >
              {SETTINGS_TABS.map((tab) => (
                <button
                  key={tab.key}
                  id={`settings-tab-${tab.key}`}
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  aria-controls="settings-tabpanel"
                  tabIndex={activeTab === tab.key ? 0 : -1}
                  onClick={() => setActiveTab(tab.key)}
                  className={`flex flex-shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm transition-colors ${activeTab === tab.key ? 'bg-sidebar font-medium text-blue-600 shadow-sm dark:bg-white/[0.08] dark:text-blue-400' : 'text-gray-600 hover:bg-muted dark:text-gray-400 dark:hover:bg-white/[0.04]'}`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-transparent relative overflow-hidden">
            <div
              id="settings-tabpanel"
              role="tabpanel"
              aria-labelledby={`settings-tab-${activeTab}`}
              className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar p-5 sm:p-6"
            >
            {activeTab === 'general' && (
              <GeneralSettingsTab
                settings={settings}
                zipDownloadRouteSummary={zipDownloadRouteSummary}
                commitSettings={commitSettings}
                onOpenZipDownloadRouteManager={() => setShowZipDownloadRouteManager(true)}
                toggleTaskCompletionNotification={toggleTaskCompletionNotification}
              />
            )}

            {activeTab === 'agent' && (
              <AgentSettingsTab
                settings={settings}
                agentMaxToolRoundsInput={agentMaxToolRoundsInput}
                setAgentMaxToolRoundsInput={setAgentMaxToolRoundsInput}
                commitSettings={commitSettings}
                commitAgentMaxToolRounds={commitAgentMaxToolRounds}
              />
            )}

            {activeTab === 'sub2api' && (
              <Sub2ApiSettingsTab settings={settings} commitSettings={commitSettings} />
            )}

            {activeTab === 'data' && (
              <div className="space-y-4">
                <div className="rounded-2xl bg-gray-50/80 p-4 border border-gray-200/60 dark:bg-white/[0.02] dark:border-white/[0.05] flex items-start gap-3">
                  <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <div className="text-[13px] leading-relaxed text-gray-500 dark:text-gray-400">
                    配置和未保存到云端的内容仅保存在当前浏览器。清理站点数据或重置浏览器前，请先导出备份。云端自动保存与容量请在 Sub2API 标签页查看。
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02] space-y-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <ExportIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                    <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">导出数据</h4>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-3">
                    <Checkbox
                      checked={exportConfig}
                      onChange={setExportConfig}
                      label="包含配置"
                    />
                    <Checkbox
                      checked={exportTasks}
                      onChange={setExportTasks}
                      label="包含任务和图片"
                    />
                    <Checkbox
                      checked={exportPromptProjects}
                      onChange={setExportPromptProjects}
                      label="包含提示词项目"
                    />
                  </div>
                  <button
                    onClick={handleExport}
                    disabled={(!exportConfig && !exportTasks && !exportPromptProjects) || isExportingData}
                    className="w-full rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 disabled:hover:bg-gray-100/80 disabled:hover:text-gray-700 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white dark:disabled:hover:bg-white/[0.06] dark:disabled:hover:text-gray-300 flex items-center justify-center gap-2"
                  >
                    {isExportingData ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        导出中...
                      </>
                    ) : (
                      '导出所选数据'
                    )}
                  </button>
                </div>

                <div className="rounded-2xl border border-gray-100 bg-white p-4 dark:border-white/[0.06] dark:bg-white/[0.02] space-y-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <ImportIcon className="w-4 h-4 text-gray-700 dark:text-gray-300" />
                    <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">导入数据</h4>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-3">
                    <Checkbox
                      checked={importConfig}
                      onChange={setImportConfig}
                      label="包含配置"
                    />
                    <Checkbox
                      checked={importTasks}
                      onChange={setImportTasks}
                      label="包含任务和图片"
                    />
                    <Checkbox
                      checked={importPromptProjects}
                      onChange={setImportPromptProjects}
                      label="包含提示词项目"
                    />
                  </div>
                  <button
                    onClick={() => importInputRef.current?.click()}
                    disabled={(!importConfig && !importTasks && !importPromptProjects) || isImportingData}
                    className="w-full rounded-xl bg-gray-100/80 px-4 py-2.5 text-sm font-medium text-gray-700 transition-all hover:bg-gray-200 hover:text-gray-900 disabled:opacity-50 disabled:hover:bg-gray-100/80 disabled:hover:text-gray-700 dark:bg-white/[0.06] dark:text-gray-300 dark:hover:bg-white/[0.1] dark:hover:text-white dark:disabled:hover:bg-white/[0.06] dark:disabled:hover:text-gray-300 flex items-center justify-center gap-2"
                  >
                    {isImportingData ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        导入中...
                      </>
                    ) : (
                      '从 ZIP 导入所选数据'
                    )}
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept=".zip"
                    className="hidden"
                    onChange={handleImport}
                  />
                </div>

                <div className="rounded-2xl border border-red-100/50 bg-red-50/30 p-4 dark:border-red-500/10 dark:bg-red-500/5 space-y-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <TrashIcon className="w-4 h-4 text-red-500/90 dark:text-red-400" />
                    <h4 className="text-sm font-bold text-red-500/90 dark:text-red-400">清除数据</h4>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-3">
                    <Checkbox
                      checked={clearConfig}
                      onChange={setClearConfig}
                      label="包含配置"
                      tone="danger"
                    />
                    <Checkbox
                      checked={clearTasks}
                      onChange={setClearTasks}
                      label="包含任务和图片"
                      tone="danger"
                    />
                    <Checkbox
                      checked={clearPromptProjects}
                      onChange={setClearPromptProjects}
                      label="包含提示词项目"
                      tone="danger"
                    />
                  </div>
                  <button
                    onClick={() =>
                      setConfirmDialog({
                        title: '清空所选数据',
                        message: clearPromptProjects
                          ? '确定要清空所选的数据吗？本次包含提示词项目，此操作不可恢复。'
                          : '确定要清空所选的数据吗？本次不包含提示词项目，此操作不可恢复。',
                        action: () => handleClearAllData(),
                      })
                    }
                    disabled={(!clearConfig && !clearTasks && !clearPromptProjects) || isClearingData}
                    className="w-full rounded-xl border border-red-200/60 bg-red-50/50 px-4 py-2.5 text-sm font-medium text-red-500 transition-all hover:bg-red-50 hover:border-red-200 hover:text-red-600 disabled:opacity-50 disabled:hover:bg-red-50/50 disabled:hover:border-red-200/60 disabled:hover:text-red-500 dark:border-red-500/15 dark:bg-red-500/5 dark:text-red-400 dark:hover:bg-red-500/10 dark:hover:border-red-500/30 dark:hover:text-red-300 dark:disabled:hover:bg-red-500/5 dark:disabled:hover:border-red-500/15 dark:disabled:hover:text-red-400 flex items-center justify-center gap-2"
                  >
                    {isClearingData ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        清空中...
                      </>
                    ) : (
                      '清空所选数据'
                    )}
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
      </div>

        {showZipDownloadRouteManager && createPortal(
          <div
            data-no-drag-select
            className="fixed inset-0 z-[110] flex items-center justify-center p-4"
            onClick={() => setShowZipDownloadRouteManager(false)}
          >
            <div className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-md animate-overlay-in" />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="使用压缩包进行批量下载"
              className="relative z-10 w-full max-w-md rounded-3xl bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl border border-white/50 dark:border-white/[0.08] shadow-[0_8px_40px_rgb(0,0,0,0.12)] dark:shadow-[0_8px_40px_rgb(0,0,0,0.4)] ring-1 ring-black/5 dark:ring-white/10 animate-confirm-in flex flex-col max-h-[85dvh] sm:max-h-[90dvh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="shrink-0 p-6 pb-2">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <h3 className="text-base font-bold text-gray-800 dark:text-gray-100">使用压缩包进行批量下载</h3>
                  <button
                    type="button"
                    onClick={() => setShowZipDownloadRouteManager(false)}
                    className="shrink-0 rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
                    aria-label="关闭"
                  >
                    <CloseIcon className="h-5 w-5" />
                  </button>
                </div>

                <div data-selectable-text className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">
                  开启后，在对应途径进行批量下载时会将结果下载为一个 ZIP，而不是多个图片文件。勾选即生效。
                </div>
              </div>

              <div ref={zipDownloadRouteScrollBoundaryRef} className="flex-1 overflow-y-auto px-6 space-y-3 custom-scrollbar min-h-0 py-2">
                {ZIP_DOWNLOAD_ROUTE_OPTIONS.map((option) => {
                  const isChecked = settings.zipDownloadRoutes.includes(option.route)
                  return (
                    <div
                      key={option.route}
                      onClick={() => setZipDownloadRouteEnabled(option.route, !isChecked)}
                      className={`cursor-pointer rounded-2xl border p-3.5 transition-colors ${isChecked ? 'border-blue-500/30 bg-blue-50/50 dark:border-blue-400/30 dark:bg-blue-500/[0.05]' : 'border-gray-100 bg-gray-50/70 hover:bg-gray-100/70 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:bg-white/[0.05]'}`}
                    >
                      <div onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={isChecked}
                          onChange={(checked) => setZipDownloadRouteEnabled(option.route, checked)}
                          label={<span className="text-sm font-medium text-gray-700 dark:text-gray-200">{option.label}</span>}
                        />
                      </div>
                      <div data-selectable-text className="mt-1.5 pl-6 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                        {option.description}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="shrink-0 p-6 pt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowZipDownloadRouteManager(false)}
                  className="flex-1 rounded-lg bg-blue-500 py-2 text-sm font-medium text-white transition hover:bg-blue-600"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
