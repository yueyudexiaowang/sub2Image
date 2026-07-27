import { listSub2Keys, listSub2Models, SUB2_AUTH_CHANGED_EVENT, type Sub2Key, type Sub2Model } from './sub2api'

/** 一个分组及其可用模型（分组信息从 Key 上聚合，每组取一个可用 Key 发起请求）。 */
export interface Sub2GroupModels {
  groupId: number
  groupName: string
  platform: string
  /** 该分组下用于请求/保存的 Key（优先保留已保存的 keyId，见 pickGroupKey） */
  keys: Sub2Key[]
  models: Sub2Model[]
  error?: string
}

/** 复合值分隔符：`${groupId}::${modelId}` */
export const SUB2_GROUP_MODEL_SEP = '::'

export function makeGroupModelValue(groupId: number, model: string) {
  return `${groupId}${SUB2_GROUP_MODEL_SEP}${model}`
}

export function parseGroupModelValue(value: string): { groupId: number; model: string } | null {
  const index = value.indexOf(SUB2_GROUP_MODEL_SEP)
  if (index <= 0) return null
  const groupId = Number(value.slice(0, index))
  const model = value.slice(index + SUB2_GROUP_MODEL_SEP.length)
  if (!Number.isFinite(groupId) || !model) return null
  return { groupId, model }
}

export function formatSub2GroupLabel(groupName: string, platform: string, groupId: number) {
  const name = groupName || `分组 ${groupId}`
  return platform ? `${name} · ${platform}` : name
}

export function formatSub2ModelLabel(model: Sub2Model) {
  return model.display_name && model.display_name !== model.id
    ? `${model.display_name}（${model.id}）`
    : model.id
}

export function filterActiveSub2Keys(keys: Sub2Key[]) {
  return keys.filter((item) => item.status === 'active' && item.group_id != null)
}

/** 在分组内挑 Key：优先沿用已保存的 keyId，否则取该分组第一个 Key。 */
export function pickGroupKey(keys: Sub2Key[], preferredKeyId?: number) {
  return keys.find((item) => item.id === preferredKeyId) ?? keys[0]
}

// ---- 会话级缓存（避免每次打开弹层/设置页都重新请求） ----

const modelCache = new Map<string, Sub2Model[]>()
let keysCache: Sub2Key[] | null = null

export function clearSub2ModelCatalogCache() {
  modelCache.clear()
  keysCache = null
}

// 登录态变化（登录/退出/换账号）时清空缓存，避免读到上一个账号的 Key 和模型
if (typeof window !== 'undefined') {
  window.addEventListener(SUB2_AUTH_CHANGED_EVENT, clearSub2ModelCatalogCache)
}

export async function fetchSub2Models(apiKey: string, force = false): Promise<Sub2Model[]> {
  if (!force) {
    const cached = modelCache.get(apiKey)
    if (cached) return cached
  }
  const models = await listSub2Models(apiKey)
  modelCache.set(apiKey, models)
  return models
}

export async function fetchActiveSub2Keys(force = false): Promise<Sub2Key[]> {
  if (!force && keysCache) return keysCache
  const keys = filterActiveSub2Keys(await listSub2Keys())
  keysCache = keys
  return keys
}

/** 把 active keys 按分组聚合（不含模型）。 */
export function groupSub2Keys(activeKeys: Sub2Key[]): Array<Omit<Sub2GroupModels, 'models' | 'error'>> {
  const groups = new Map<number, Omit<Sub2GroupModels, 'models' | 'error'>>()
  activeKeys.forEach((item) => {
    const groupId = Number(item.group_id)
    const existing = groups.get(groupId)
    if (existing) {
      existing.keys.push(item)
      return
    }
    groups.set(groupId, {
      groupId,
      groupName: item.group?.name || '',
      platform: item.group?.platform || '',
      keys: [item],
    })
  })
  return [...groups.values()]
}

/** 并发拉取所有分组的模型列表；单个分组失败不影响其它分组（记录在 error 上）。 */
export async function loadSub2GroupModels(activeKeys: Sub2Key[], force = false): Promise<Sub2GroupModels[]> {
  const groups = groupSub2Keys(activeKeys)
  return Promise.all(groups.map(async (group) => {
    const key = pickGroupKey(group.keys)
    try {
      const models = key ? await fetchSub2Models(key.key, force) : []
      return { ...group, models }
    } catch (err) {
      console.warn('[Sub2API] 获取分组模型失败', { groupId: group.groupId, err })
      return { ...group, models: [], error: err instanceof Error ? err.message : String(err) }
    }
  }))
}
