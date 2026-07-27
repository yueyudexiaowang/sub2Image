import { useSyncExternalStore } from 'react'
import {
  getSub2Token,
  getSub2User,
  SUB2_AUTH_CHANGED_EVENT,
  SUB2_AUTH_STORAGE_KEY,
  type Sub2User,
} from '../lib/sub2api'

function subscribe(callback: () => void) {
  window.addEventListener(SUB2_AUTH_CHANGED_EVENT, callback)
  // 其它标签页登录/退出时通过 storage 事件同步
  window.addEventListener('storage', callback)
  return () => {
    window.removeEventListener(SUB2_AUTH_CHANGED_EVENT, callback)
    window.removeEventListener('storage', callback)
  }
}

// useSyncExternalStore 要求快照引用稳定，这里按原始字符串缓存解析结果
let cachedUserRaw: string | null = null
let cachedUser: Sub2User | null = null

function getUserSnapshot(): Sub2User | null {
  const raw = localStorage.getItem(SUB2_AUTH_STORAGE_KEY)
  if (raw !== cachedUserRaw) {
    cachedUserRaw = raw
    cachedUser = getSub2User()
  }
  return cachedUser
}

/**
 * 响应式的 Sub2API 登录态。
 * 替代在渲染期直读 getSub2Token()/getSub2User()——那样在别处登录/退出后 UI 不会更新。
 */
export function useSub2Auth() {
  const token = useSyncExternalStore(subscribe, getSub2Token, () => '')
  const user = useSyncExternalStore(subscribe, getUserSnapshot, () => null)
  return { token, user, loggedIn: Boolean(token) }
}
