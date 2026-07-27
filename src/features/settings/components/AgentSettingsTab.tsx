import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_AGENT_MAX_TOOL_ROUNDS,
  type AppSettings,
  type Sub2Config,
} from '../../../types'
import { useStore } from '../../../store'
import { normalizeAgentMaxToolRounds } from '../../../lib/apiProfiles'
import {
  getSub2Token,
  listSub2Groups,
  listSub2GroupModels,
  listSub2Keys,
  OPEN_SUB2_CONNECT_EVENT,
  type Sub2Group,
  type Sub2Key,
} from '../../../lib/sub2api'
import { syncSub2Settings } from '../../../lib/sub2Profiles'
import Select from '../../../components/ui/Select'

interface AgentSettingsTabProps {
  draft: AppSettings
  agentMaxToolRoundsInput: string
  setAgentMaxToolRoundsInput: (value: string) => void
  commitSettings: (nextDraft: AppSettings) => void
  commitAgentMaxToolRounds: () => void
}

export default function AgentSettingsTab({
  draft,
  agentMaxToolRoundsInput,
  setAgentMaxToolRoundsInput,
  commitSettings,
  commitAgentMaxToolRounds,
}: AgentSettingsTabProps) {
  const showToast = useStore((s) => s.showToast)
  const textConfig = draft.sub2Configs.find((config) => config.profileId === draft.agentTextProfileId)
    ?? draft.sub2Configs.find((config) => config.kind === 'text')
  const imageConfig = draft.sub2Configs.find((config) => config.profileId === draft.agentImageProfileId)
    ?? draft.sub2Configs.find((config) => config.kind === 'image')
  const videoConfig = draft.sub2Configs.find((config) => config.profileId === draft.agentVideoProfileId)
    ?? draft.sub2Configs.find((config) => config.kind === 'video')
  const [keys, setKeys] = useState<Sub2Key[]>([])
  const [groups, setGroups] = useState<Sub2Group[]>([])
  const [textGroupId, setTextGroupId] = useState(textConfig?.groupId ?? 0)
  const [imageGroupId, setImageGroupId] = useState(imageConfig?.groupId ?? 0)
  const [videoKeyId, setVideoKeyId] = useState(videoConfig?.keyId ?? 0)
  const [textModel, setTextModel] = useState(textConfig?.model ?? '')
  const [imageModel, setImageModel] = useState(imageConfig?.model ?? '')
  const [videoModel, setVideoModel] = useState(videoConfig?.model ?? '')
  const [textModels, setTextModels] = useState<string[]>([])
  const [imageModels, setImageModels] = useState<string[]>([])
  const [videoModels, setVideoModels] = useState<string[]>([])
  const [loading, setLoading] = useState<'keys' | 'text' | 'image' | 'video' | ''>('')
  const [error, setError] = useState('')

  const activeKeys = useMemo(() => keys.filter((item) => item.status === 'active' && item.group_id != null), [keys])
  const keyMap = useMemo(() => new Map(activeKeys.map((item) => [item.id, item.key])), [activeKeys])
  const groupMap = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups])
  const groupOptions = useMemo(() => {
    return groups
      .map((group) => ({
        label: group.platform ? `${group.name} · ${group.platform}` : group.name,
        value: group.id,
      }))
  }, [activeKeys, groups])

  const loadModels = async (kind: Sub2Config['kind'], groupId: number, items = activeKeys, selectedKeyId?: number) => {
    const savedKeyId = selectedKeyId ?? (kind === 'text' ? textConfig?.keyId : kind === 'image' ? imageConfig?.keyId : videoConfig?.keyId)
    const key = items.find((item) => item.id === savedKeyId && Number(item.group_id) === groupId)
      ?? items.find((item) => Number(item.group_id) === groupId)
    if (!key) {
      if (kind === 'text') setTextModels([])
      else if (kind === 'image') setImageModels([])
      else setVideoModels([])
      setError('所选分组暂无可用的 Sub2API Key')
      return
    }

    setLoading(kind)
    setError('')
    try {
      const models = (await listSub2GroupModels(groupId, key.key)).map((item) => item.id)
      if (kind === 'text') {
        setTextModels(models)
        if (!models.includes(textModel)) setTextModel('')
      } else if (kind === 'image') {
        setImageModels(models)
        if (!models.includes(imageModel)) setImageModel('')
      } else {
        setVideoModels(models)
        if (!models.includes(videoModel)) setVideoModel('')
      }
      if (!models.length) setError(`所选分组没有可用的${kind === 'text' ? '文本' : kind === 'image' ? '图像' : '视频'}模型`)
    } catch (err) {
      console.error('[Sub2API] 获取分组模型失败', { kind, groupId, err })
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading('')
    }
  }

  const loadKeys = async () => {
    setLoading('keys')
    setError('')
    try {
      const [availableGroups, allItems] = await Promise.all([
        listSub2Groups(),
        listSub2Keys(),
      ])
      const items = allItems.filter((item) => item.status === 'active' && item.group_id != null)
      const textProfile = draft.profiles.find((profile) => profile.id === textConfig?.profileId)
      const imageProfile = draft.profiles.find((profile) => profile.id === imageConfig?.profileId)
      const videoProfile = draft.profiles.find((profile) => profile.id === videoConfig?.profileId)
      const textKey = items.find((item) => item.id === textConfig?.keyId)
      const imageKey = items.find((item) => item.id === imageConfig?.keyId)
      const videoKey = items.find((item) => item.id === videoConfig?.keyId)
      const accountChanged = Boolean(
        (textConfig && textKey?.key !== textProfile?.apiKey)
        || (imageConfig && imageKey?.key !== imageProfile?.apiKey)
        || (videoConfig && videoKey?.key !== videoProfile?.apiKey),
      )
      setGroups(availableGroups)
      setKeys(items)
      if (accountChanged) {
        setTextGroupId(0)
        setImageGroupId(0)
        setVideoKeyId(0)
        setTextModel('')
        setImageModel('')
        setVideoModel('')
        setTextModels([])
        setImageModels([])
        setVideoModels([])
        commitSettings(syncSub2Settings(draft, [], new Map()))
        showToast('账号分组已变化，请重新配置 Agent 模型', 'info')
        return
      }

      const hasGroup = (groupId: number) => availableGroups.some((group) => group.id === groupId)
        && items.some((item) => Number(item.group_id) === groupId)
      const nextTextGroupId = hasGroup(textGroupId) ? textGroupId : 0
      const nextImageGroupId = hasGroup(imageGroupId) ? imageGroupId : 0
      const nextVideoKeyId = items.some((item) => item.id === videoKeyId) ? videoKeyId : 0
      setTextGroupId(nextTextGroupId)
      setImageGroupId(nextImageGroupId)
      setVideoKeyId(nextVideoKeyId)
      if (!nextTextGroupId) setTextModel('')
      if (!nextImageGroupId) setImageModel('')
      if (!nextVideoKeyId) setVideoModel('')
      if (nextTextGroupId) await loadModels('text', nextTextGroupId, items)
      if (nextImageGroupId) await loadModels('image', nextImageGroupId, items)
      const nextVideoKey = items.find((item) => item.id === nextVideoKeyId)
      if (nextVideoKey?.group_id != null) await loadModels('video', Number(nextVideoKey.group_id), items, nextVideoKey.id)
    } catch (err) {
      console.error('[Sub2API] 获取用户分组失败', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading('')
    }
  }

  useEffect(() => {
    if (getSub2Token()) void loadKeys()
  }, [])

  const saveConfigs = () => {
    const textKey = activeKeys.find((item) => item.id === textConfig?.keyId && Number(item.group_id) === textGroupId)
      ?? activeKeys.find((item) => Number(item.group_id) === textGroupId)
    const imageKey = activeKeys.find((item) => item.id === imageConfig?.keyId && Number(item.group_id) === imageGroupId)
      ?? activeKeys.find((item) => Number(item.group_id) === imageGroupId)
    const videoKey = activeKeys.find((item) => item.id === videoKeyId)
    if (!textKey || !imageKey || !textModel || !imageModel) return
    if ((videoKeyId || videoModel) && (!videoKey || !videoModel)) return

    const textGroup = groupMap.get(textGroupId)
    const imageGroup = groupMap.get(imageGroupId)
    const videoGroup = videoKey?.group_id == null ? undefined : groupMap.get(Number(videoKey.group_id))

    const textId = textConfig?.id ?? `agent-text-${Date.now().toString(36)}`
    const imageId = imageConfig?.id ?? `agent-image-${Date.now().toString(36)}`
    const videoId = videoConfig?.id ?? `agent-video-${Date.now().toString(36)}`
    const nextText: Sub2Config = {
      id: textId,
      name: 'Agent 文本',
      kind: 'text',
      keyId: textKey.id,
      keyName: textKey.name,
      groupId: Number(textKey.group_id),
      groupName: textGroup?.name || textKey.group?.name || '',
      platform: textGroup?.platform || textKey.group?.platform || '',
      model: textModel,
      profileId: textConfig?.profileId ?? `sub2api-text-${textId}`,
    }
    const nextImage: Sub2Config = {
      id: imageId,
      name: 'Agent 图像',
      kind: 'image',
      keyId: imageKey.id,
      keyName: imageKey.name,
      groupId: Number(imageKey.group_id),
      groupName: imageGroup?.name || imageKey.group?.name || '',
      platform: imageGroup?.platform || imageKey.group?.platform || '',
      model: imageModel,
      profileId: imageConfig?.profileId ?? `sub2api-image-${imageId}`,
    }
    const nextVideo: Sub2Config | null = videoKey && videoModel ? {
      id: videoId,
      name: 'Agent 视频',
      kind: 'video',
      keyId: videoKey.id,
      keyName: videoKey.name,
      groupId: Number(videoKey.group_id),
      groupName: videoGroup?.name || videoKey.group?.name || '',
      platform: videoGroup?.platform || videoKey.group?.platform || '',
      model: videoModel,
      profileId: videoConfig?.profileId ?? `sub2api-video-${videoId}`,
    } : null
    const configs = draft.sub2Configs
      .filter((config) => config.kind !== 'text' && config.kind !== 'image' && config.kind !== 'video')
      .concat(nextText, nextImage, ...(nextVideo ? [nextVideo] : []))
    commitSettings(syncSub2Settings(draft, configs, keyMap, nextImage.profileId))
    showToast('Agent 模型配置已保存', 'success')
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-blue-50 px-3 py-2.5 text-xs leading-relaxed text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
        Agent 固定使用 Sub2API 混合模式，文本、图像和视频模型分别配置。
      </div>

      {!getSub2Token() ? (
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
            <button type="button" disabled={Boolean(loading)} onClick={() => void loadKeys()} className="rounded-lg px-3 py-1.5 text-xs text-blue-500 hover:bg-blue-50 disabled:opacity-50 dark:hover:bg-blue-500/10">刷新</button>
          </div>

          <section className="space-y-3 border-b border-gray-200/70 pb-5 dark:border-white/[0.08]">
            <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">文本</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="block text-xs text-gray-500">
                文本分组
                <Select
                  value={textGroupId || ''}
                  disabled={!groupOptions.length || Boolean(loading)}
                  onChange={(value) => {
                    const id = Number(value)
                    setTextGroupId(id)
                    setTextModel('')
                    setTextModels([])
                    if (id) void loadModels('text', id)
                  }}
                  options={[
                    { value: '', label: groupOptions.length ? '请选择文本分组' : '暂无可用分组' },
                    ...groupOptions,
                  ]}
                  className="mt-1.5 w-full"
                />
              </div>
              <div className="block text-xs text-gray-500">
                文本模型
                <Select
                  value={textModel}
                  disabled={!textModels.length || Boolean(loading)}
                  onChange={(value) => setTextModel(String(value))}
                  options={[
                    { value: '', label: loading === 'text' ? '正在读取...' : '请选择文本模型' },
                    ...textModels.map((id) => ({ value: id, label: id })),
                  ]}
                  className="mt-1.5 w-full"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3 border-b border-gray-200/70 pb-5 dark:border-white/[0.08]">
            <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">图像</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="block text-xs text-gray-500">
                图像分组
                <Select
                  value={imageGroupId || ''}
                  disabled={!groupOptions.length || Boolean(loading)}
                  onChange={(value) => {
                    const id = Number(value)
                    setImageGroupId(id)
                    setImageModel('')
                    setImageModels([])
                    if (id) void loadModels('image', id)
                  }}
                  options={[
                    { value: '', label: groupOptions.length ? '请选择图像分组' : '暂无可用分组' },
                    ...groupOptions,
                  ]}
                  className="mt-1.5 w-full"
                />
              </div>
              <div className="block text-xs text-gray-500">
                图像模型
                <Select
                  value={imageModel}
                  disabled={!imageModels.length || Boolean(loading)}
                  onChange={(value) => setImageModel(String(value))}
                  options={[
                    { value: '', label: loading === 'image' ? '正在读取...' : '请选择图像模型' },
                    ...imageModels.map((id) => ({ value: id, label: id })),
                  ]}
                  className="mt-1.5 w-full"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100">视频</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="block text-xs text-gray-500">
                视频 Key
                <Select
                  value={videoKeyId || ''}
                  disabled={!activeKeys.length || Boolean(loading)}
                  onChange={(value) => {
                    const id = Number(value)
                    setVideoKeyId(id)
                    setVideoModel('')
                    setVideoModels([])
                    const key = activeKeys.find((item) => item.id === id)
                    if (key?.group_id != null) void loadModels('video', Number(key.group_id), activeKeys, key.id)
                  }}
                  options={[
                    { value: '', label: activeKeys.length ? '不配置视频模型' : '暂无可用 Key' },
                    ...activeKeys.map((item) => ({
                      value: item.id,
                      label: item.group?.name ? `${item.name} · ${item.group.name}` : item.name,
                    })),
                  ]}
                  className="mt-1.5 w-full"
                />
              </div>
              <div className="block text-xs text-gray-500">
                视频模型
                <Select
                  value={videoModel}
                  disabled={!videoModels.length || Boolean(loading)}
                  onChange={(value) => setVideoModel(String(value))}
                  options={[
                    { value: '', label: loading === 'video' ? '正在读取...' : '请选择视频模型' },
                    ...videoModels.map((id) => ({ value: id, label: id })),
                  ]}
                  className="mt-1.5 w-full"
                />
              </div>
            </div>
          </section>

          {error && <div className="border-l-2 border-red-500 bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-300">{error}</div>}
          <button type="button" disabled={!textGroupId || !imageGroupId || !textModel || !imageModel || Boolean(videoKeyId) !== Boolean(videoModel) || Boolean(loading)} onClick={saveConfigs} className="w-full rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-40">保存 Agent 模型配置</button>
        </>
      )}

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

      <div className="block">
        <div className="mb-1 flex items-center justify-between gap-3">
          <span className="block text-sm text-gray-600 dark:text-gray-300">网络搜索</span>
          <button
            type="button"
            onClick={() => {
              const agentMaxToolRounds = agentMaxToolRoundsInput.trim() === ''
                ? DEFAULT_AGENT_MAX_TOOL_ROUNDS
                : normalizeAgentMaxToolRounds(agentMaxToolRoundsInput, draft.agentMaxToolRounds)
              setAgentMaxToolRoundsInput(String(agentMaxToolRounds))
              commitSettings({ ...draft, agentMaxToolRounds, agentWebSearch: !draft.agentWebSearch })
            }}
            className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${draft.agentWebSearch ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
            role="switch"
            aria-checked={draft.agentWebSearch}
            aria-label="网络搜索"
          >
            <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${draft.agentWebSearch ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
          </button>
        </div>
        <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
          启用 Responses API 的 <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] dark:bg-white/[0.06]">web_search</code> 工具。模型每次调用此工具会产生少量固定价格的额外计费。
        </div>
      </div>
    </div>
  )
}
