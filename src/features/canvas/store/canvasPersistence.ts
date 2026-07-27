// 画布文档的去抖持久化：同一时刻只编辑一个文档，串行写入避免陈旧覆盖。
import type { CanvasDocument } from '../types'
import { putCanvasDocument } from '../../../lib/db'

const SAVE_DELAY_MS = 400

let pending: CanvasDocument | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let writing: Promise<void> = Promise.resolve()

function writePending() {
  const doc = pending
  pending = null
  if (!doc) return writing
  writing = writing
    .catch(() => undefined)
    .then(() => putCanvasDocument(doc))
    .then(() => undefined, (err) => {
      console.error('保存画布失败：', err)
    })
  return writing
}

export function scheduleCanvasSave(doc: CanvasDocument) {
  pending = doc
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void writePending()
  }, SAVE_DELAY_MS)
}

/** 离开画布或页面卸载前调用，确保未落盘的修改写入。 */
export async function flushCanvasSave() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  await writePending()
}
