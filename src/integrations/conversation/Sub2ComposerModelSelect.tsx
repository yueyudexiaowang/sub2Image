import { useEffect, useState } from 'react'
import { ChevronDownIcon } from '../../components/ui/icons'
import { getSub2Token } from '../../lib/sub2api'
import {
  fetchActiveSub2Keys,
  fetchSub2Models,
  formatSub2GroupLabel,
  formatSub2ModelLabel,
  loadSub2GroupModels,
  pickGroupKey,
  type Sub2GroupModels,
} from '../../lib/sub2ModelCatalog'
import { syncSub2Settings } from '../../lib/sub2Profiles'
import { useStore } from '../../store'

type Props = {
  kind: 'image' | 'video' | 'text'
  onRequestClose?: () => void
}

const KIND_LABEL = { image: '图片', video: '视频', text: '文本' } as const

/**
 * 设置弹层内的模型选择：按分组分节展示所有可用模型（与设置页一致），
 * 跨分组切换时同步更新 keyId/groupId/apiKey。
 */
export default function Sub2ComposerModelSelect({ kind, onRequestClose }: Props) {
  const settings = useStore((state) => state.settings)
  const setSettings = useStore((state) => state.setSettings)
  const config = settings.sub2Configs.find((item) => item.kind === kind)
  const profile = settings.profiles.find((item) => item.id === config?.profileId)
  const [open, setOpen] = useState(false)
  const [groups, setGroups] = useState<Sub2GroupModels[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apiKey = profile?.apiKey
  const groupId = config?.groupId
  const groupName = config?.groupName ?? ''
  const platform = config?.platform ?? ''

  useEffect(() => {
    if (!open || !config) return
    let active = true
    setLoading(true)
    setError(null)
    const load = async (): Promise<Sub2GroupModels[]> => {
      if (getSub2Token()) {
        // 已登录：拉取全部分组的模型，跨分组分节展示
        const keys = await fetchActiveSub2Keys()
        const loaded = await loadSub2GroupModels(keys)
        const usable = loaded.filter((group) => group.models.length)
        if (usable.length) return usable
      }
      // 兜底：仅展示当前已保存分组 Key 下的模型
      if (!apiKey) return []
      const models = await fetchSub2Models(apiKey)
      return [{
        groupId: groupId ?? 0,
        groupName,
        platform,
        keys: [],
        models,
      }]
    }
    void load().then((items) => {
      if (!active) return
      setGroups(items)
    }).catch((err) => {
      console.warn('加载模型列表失败：', err)
      if (active) setError('加载模型列表失败')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [open, apiKey, groupId, groupName, platform, Boolean(config)])

  // 未完成 Sub2API 配置时引导用户去设置页
  if (!config || !profile) {
    return (
      <div className="cc-settings-model" role="group" aria-label="生成模型">
        <p className="cc-settings-model-label">模型</p>
        <button
          type="button"
          className="cc-settings-model-trigger"
          onClick={() => {
            onRequestClose?.()
            useStore.getState().setShowSettings(true, 'agent')
          }}
        >
          <span className="cc-settings-model-name">尚未配置，去设置</span>
        </button>
      </div>
    )
  }

  const selectModel = (group: Sub2GroupModels, model: string) => {
    setOpen(false)
    if (model === config.model && group.groupId === config.groupId) return
    const state = useStore.getState()
    // 跨分组切换时同步替换 Key/分组信息，避免继续用旧分组的 Key 请求
    const key = pickGroupKey(group.keys, config.keyId)
    const configs = state.settings.sub2Configs.map((item) => (item.kind === kind ? {
      ...item,
      model,
      ...(key ? {
        keyId: key.id,
        keyName: key.name,
        groupId: group.groupId,
        groupName: group.groupName,
        platform: group.platform,
      } : {}),
    } : item))
    const keyMap = key ? new Map([[key.id, key.key]]) : new Map<number, string>()
    setSettings(syncSub2Settings(state.settings, configs, keyMap))
    state.showToast(`${KIND_LABEL[kind]}模型已切换为 ${model}`, 'success')
  }

  const showHeadings = groups.length > 1 || groups.some((group) => group.groupName)

  return (
    <div className="cc-settings-model" role="group" aria-label="生成模型">
      <p className="cc-settings-model-label">模型</p>
      <button
        type="button"
        className="cc-settings-model-trigger"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="cc-settings-model-name">{config.model || '选择模型'}</span>
        <ChevronDownIcon aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>
      {open && (
        <div className="cc-settings-model-list" role="listbox" aria-label="可用模型">
          {loading && <p className="cc-settings-model-hint">正在加载模型…</p>}
          {error && <p className="cc-settings-model-hint">{error}</p>}
          {!loading && !error && !groups.length && <p className="cc-settings-model-hint">该分组暂无可用模型</p>}
          {!loading && groups.map((group) => (
            <div key={group.groupId} className="cc-settings-model-section" role="presentation">
              {showHeadings && (
                <p className="cc-settings-model-group" aria-hidden="true">
                  {formatSub2GroupLabel(group.groupName, group.platform, group.groupId)}
                </p>
              )}
              {group.models.map((model) => {
                const isActive = model.id === config.model && group.groupId === config.groupId
                return (
                  <button
                    key={`${group.groupId}-${model.id}`}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={isActive ? 'is-active' : ''}
                    onClick={() => selectModel(group, model.id)}
                  >
                    {formatSub2ModelLabel(model)}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
