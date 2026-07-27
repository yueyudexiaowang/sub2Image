import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_AGENT_MAX_TOOL_ROUNDS,
  type AppSettings,
  type Sub2Config,
} from '../../../types'
import { useStore } from '../../../store'
import { normalizeAgentMaxToolRounds } from '../../../lib/apiProfiles'
import {
  OPEN_SUB2_CONNECT_EVENT,
  type Sub2Key,
} from '../../../lib/sub2api'
import {
  fetchActiveSub2Keys,
  formatSub2GroupLabel,
  formatSub2ModelLabel,
  loadSub2GroupModels,
  makeGroupModelValue,
  parseGroupModelValue,
  pickGroupKey,
  type Sub2GroupModels,
} from '../../../lib/sub2ModelCatalog'
import { syncSub2Settings } from '../../../lib/sub2Profiles'
import { useSub2Auth } from '../../../hooks/useSub2Auth'
import Select, { type SelectOption } from '../../../components/ui/Select'
import SettingToggleRow from './SettingToggleRow'

interface AgentSettingsTabProps {
  settings: AppSettings
  agentMaxToolRoundsInput: string
  setAgentMaxToolRoundsInput: (value: string) => void
  commitSettings: (nextSettings: AppSettings) => void
  commitAgentMaxToolRounds: () => void
}

const KIND_LABEL = { text: '文本', image: '图像', video: '视频' } as const

export default function AgentSettingsTab({
  settings,
  agentMaxToolRoundsInput,
  setAgentMaxToolRoundsInput,
  commitSettings,
  commitAgentMaxToolRounds,
}: AgentSettingsTabProps) {
  const showToast = useStore((s) => s.showToast)
  const { loggedIn } = useSub2Auth()
  const textConfig = settings.sub2Configs.find((config) => config.profileId === settings.agentTextProfileId)
    ?? settings.sub2Configs.find((config) => config.kind === 'text')
  const imageConfig = settings.sub2Configs.find((config) => config.profileId === settings.agentImageProfileId)
    ?? settings.sub2Configs.find((config) => config.kind === 'image')
  const videoConfig = settings.sub2Configs.find((config) => config.profileId === settings.agentVideoProfileId)
    ?? settings.sub2Configs.find((config) => config.kind === 'video')
  const [keys, setKeys] = useState<Sub2Key[]>([])
  const [groupModels, setGroupModels] = useState<Sub2GroupModels[]>([])
  const [textValue, setTextValue] = useState(textConfig?.model ? makeGroupModelValue(textConfig.groupId, textConfig.model) : '')
  const [imageValue, setImageValue] = useState(imageConfig?.model ? makeGroupModelValue(imageConfig.groupId, imageConfig.model) : '')
  const [videoValue, setVideoValue] = useState(videoConfig?.model ? makeGroupModelValue(videoConfig.groupId, videoConfig.model) : '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const keyMap = useMemo(() => new Map(keys.map((item) => [item.id, item.key])), [keys])

  /** 单个分组选择器的选项：分组名作分节标题，模型作可选项。 */
  const buildGroupedOptions = (placeholder: string): SelectOption[] => {
    const options: SelectOption[] = [{
      value: '',
      label: loading ? '正在读取...' : groupModels.length ? placeholder : '暂无可用分组',
    }]
    groupModels.forEach((group) => {
      if (!group.models.length) return
      options.push({
        value: `group-${group.groupId}`,
        label: formatSub2GroupLabel(group.groupName, group.platform, group.groupId),
        heading: true,
      })
      group.models.forEach((model) => {
        options.push({
          value: makeGroupModelValue(group.groupId, model.id),
          label: formatSub2ModelLabel(model),
        })
      })
    })
    return options
  }

  const hasSelectableModels = groupModels.some((group) => group.models.length > 0)

  const loadKeys = async (force = false) => {
    setLoading(true)
    setError('')
    try {
      const items = await fetchActiveSub2Keys(force)
      // 异步回调里读最新 settings，避免闭包里的旧值覆盖外部改动
      const current = useStore.getState().settings
      const textProfile = current.profiles.find((profile) => profile.id === textConfig?.profileId)
      const imageProfile = current.profiles.find((profile) => profile.id === imageConfig?.profileId)
      const videoProfile = current.profiles.find((profile) => profile.id === videoConfig?.profileId)
      const textKey = items.find((item) => item.id === textConfig?.keyId)
      const imageKey = items.find((item) => item.id === imageConfig?.keyId)
      const videoKey = items.find((item) => item.id === videoConfig?.keyId)
      const accountChanged = Boolean(
        (textConfig && textKey?.key !== textProfile?.apiKey)
        || (imageConfig && imageKey?.key !== imageProfile?.apiKey)
        || (videoConfig && videoKey?.key !== videoProfile?.apiKey),
      )
      setKeys(items)
      if (accountChanged) {
        setTextValue('')
        setImageValue('')
        setVideoValue('')
        setGroupModels([])
        commitSettings(syncSub2Settings(current, [], new Map()))
        showToast('账号分组已变化，请重新配置 Agent 模型', 'info')
        return
      }

      const groups = await loadSub2GroupModels(items, force)
      setGroupModels(groups)

      // 校验已选值仍然有效（分组还在、模型还在列表中），否则清空
      const validate = (value: string) => {
        const parsed = parseGroupModelValue(value)
        if (!parsed) return ''
        const group = groups.find((item) => item.groupId === parsed.groupId)
        return group?.models.some((model) => model.id === parsed.model) ? value : ''
      }
      setTextValue((value) => validate(value))
      setImageValue((value) => validate(value))
      setVideoValue((value) => validate(value))

      const failed = groups.filter((group) => group.error)
      if (failed.length) {
        setError(`部分分组模型获取失败：${failed.map((group) => formatSub2GroupLabel(group.groupName, group.platform, group.groupId)).join('、')}`)
      } else if (!groups.some((group) => group.models.length)) {
        setError('没有可用的分组模型')
      }
    } catch (err) {
      console.error('[Sub2API] 获取用户分组失败', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (loggedIn) void loadKeys()
    else {
      setKeys([])
      setGroupModels([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn])

  /** 从复合值解析出保存所需的 Key/分组/模型。 */
  const resolveSelection = (value: string, preferredKeyId?: number) => {
    const parsed = parseGroupModelValue(value)
    if (!parsed) return null
    const group = groupModels.find((item) => item.groupId === parsed.groupId)
    if (!group) return null
    const key = pickGroupKey(group.keys, preferredKeyId)
    if (!key) return null
    return { key, group, model: parsed.model }
  }

  const buildConfig = (
    kind: Sub2Config['kind'],
    selection: NonNullable<ReturnType<typeof resolveSelection>>,
    existing: Sub2Config | undefined,
  ): Sub2Config => {
    const id = existing?.id ?? `agent-${kind}-${Date.now().toString(36)}`
    return {
      id,
      name: `Agent ${KIND_LABEL[kind]}`,
      kind,
      keyId: selection.key.id,
      keyName: selection.key.name,
      groupId: selection.group.groupId,
      groupName: selection.group.groupName,
      platform: selection.group.platform,
      model: selection.model,
      profileId: existing?.profileId ?? `sub2api-${kind}-${id}`,
    }
  }

  /** 选中即生效：只变更当前编辑的 kind，其余配置原样保留（与聊天浮层行为一致）。 */
  const applySelection = (kind: Sub2Config['kind'], rawValue: string | number) => {
    const value = String(rawValue)
    if (kind === 'text') setTextValue(value)
    else if (kind === 'image') setImageValue(value)
    else setVideoValue(value)

    const existing = kind === 'text' ? textConfig : kind === 'image' ? imageConfig : videoConfig

    // 视频支持选择“不配置”清除已有配置
    if (!value) {
      if (kind === 'video' && videoConfig) {
        const configs = settings.sub2Configs.filter((config) => config.kind !== 'video')
        commitSettings(syncSub2Settings(settings, configs, keyMap, imageConfig?.profileId))
        showToast('已取消视频模型配置', 'success')
      }
      return
    }

    const selection = resolveSelection(value, existing?.keyId)
    if (!selection) {
      showToast('所选分组暂不可用，请点击“刷新”后重试', 'error')
      return
    }
    if (existing && existing.model === selection.model && existing.groupId === selection.group.groupId) return

    const nextConfig = buildConfig(kind, selection, existing)
    const configs = settings.sub2Configs
      .filter((config) => config.kind !== kind)
      .concat(nextConfig)
    const preferredActiveId = kind === 'image' ? nextConfig.profileId : imageConfig?.profileId
    commitSettings(syncSub2Settings(settings, configs, keyMap, preferredActiveId))
    showToast(`${KIND_LABEL[kind]}模型已切换为 ${selection.model}`, 'success')
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-blue-50 px-3 py-2.5 text-xs leading-relaxed text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
        Agent 固定使用 Sub2API 混合模式，文本、图像和视频模型分别配置。
      </div>

      {!loggedIn ? (
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
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-gray-200/70 pb-3 dark:border-white/[0.08]">
            <span className="text-sm font-medium text-gray-800 dark:text-gray-100">分组模型</span>
            <button type="button" disabled={loading} onClick={() => void loadKeys(true)} className="rounded-lg px-3 py-1.5 text-xs text-blue-500 hover:bg-blue-50 disabled:opacity-50 dark:hover:bg-blue-500/10">刷新</button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="block text-xs text-gray-500">
              文本模型
              <Select
                value={textValue}
                disabled={!hasSelectableModels || loading}
                onChange={(value) => applySelection('text', value)}
                options={buildGroupedOptions('请选择文本模型')}
                ariaLabel="文本模型"
                className="mt-1.5 w-full"
              />
            </div>
            <div className="block text-xs text-gray-500">
              图像模型
              <Select
                value={imageValue}
                disabled={!hasSelectableModels || loading}
                onChange={(value) => applySelection('image', value)}
                options={buildGroupedOptions('请选择图像模型')}
                ariaLabel="图像模型"
                className="mt-1.5 w-full"
              />
            </div>
            <div className="block text-xs text-gray-500">
              视频模型
              <Select
                value={videoValue}
                disabled={!hasSelectableModels || loading}
                onChange={(value) => applySelection('video', value)}
                options={buildGroupedOptions('不配置视频模型')}
                ariaLabel="视频模型"
                className="mt-1.5 w-full"
              />
            </div>
          </div>

          {error && <div role="alert" className="border-l-2 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-300">{error}</div>}
          <div data-selectable-text className="text-xs leading-relaxed text-gray-500 dark:text-gray-500">
            选中即生效，无需保存。与聊天输入框中的模型选择互通。
          </div>
        </>
      )}

      <div className="space-y-4 border-t border-gray-200/70 pt-5 dark:border-white/[0.08]">
        <label className="block">
          <span className="mb-1.5 block text-sm text-gray-600 dark:text-gray-300">最大工具调用轮数</span>
          <input
            value={agentMaxToolRoundsInput}
            onChange={(e) => setAgentMaxToolRoundsInput(e.target.value)}
            onBlur={commitAgentMaxToolRounds}
            type="number"
            min={1}
            max={50}
            className="w-full rounded-xl border border-gray-200/70 bg-white/60 px-3 py-2.5 text-sm text-gray-700 outline-none transition focus:border-blue-300 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-gray-200 dark:focus:border-blue-500/50"
          />
          <div data-selectable-text className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-500">
            默认 15。用于限制 Agent 连续调用工具时的最大轮数，防止无限循环。
          </div>
        </label>

        <SettingToggleRow
          label="网络搜索"
          description={<>
            启用 Responses API 的 <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] dark:bg-white/[0.06]">web_search</code> 工具。模型每次调用此工具会产生少量固定价格的额外计费。
          </>}
          checked={settings.agentWebSearch}
          onToggle={() => {
            const agentMaxToolRounds = agentMaxToolRoundsInput.trim() === ''
              ? DEFAULT_AGENT_MAX_TOOL_ROUNDS
              : normalizeAgentMaxToolRounds(agentMaxToolRoundsInput, settings.agentMaxToolRounds)
            setAgentMaxToolRoundsInput(String(agentMaxToolRounds))
            commitSettings({ ...settings, agentMaxToolRounds, agentWebSearch: !settings.agentWebSearch })
          }}
        />

        <SettingToggleRow
          label="发送消息后自动滚动到底部"
          description="开启后，在对话模式发送消息成功后会自动滚动到对话底部。"
          checked={settings.agentScrollToBottomAfterSubmit}
          onToggle={() => commitSettings({ ...settings, agentScrollToBottomAfterSubmit: !settings.agentScrollToBottomAfterSubmit })}
        />

        <SettingToggleRow
          label="公式输出提示"
          description={<>
            开启后，Agent 会被要求使用 <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.9em] text-gray-700 dark:bg-white/10 dark:text-gray-200">$...$</code> 和 <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.9em] text-gray-700 dark:bg-white/10 dark:text-gray-200">$$...$$</code> 输出数学公式，确保渲染效果正常。
          </>}
          checked={settings.agentMathFormattingPrompt}
          onToggle={() => commitSettings({ ...settings, agentMathFormattingPrompt: !settings.agentMathFormattingPrompt })}
        />
      </div>
    </div>
  )
}
