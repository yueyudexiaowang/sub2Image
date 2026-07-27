// 节点功能菜单的资产操作：存资产（生成画廊任务卡）、云储存、下载。
import type { CanvasImageNode, CanvasVideoNode } from '../types'
import { saveEditedToolImage } from '../../../Tools/adapters/imageStorage'
import { saveEditedToolVideo } from '../../../Tools/adapters/videoStorage'
import { getVideo } from '../../../lib/db'
import { downloadImageIds } from '../../../lib/downloadImages'
import { getSub2Token } from '../../../lib/sub2api'
import { ensureImageCached } from '../../imageLibrary'
import { saveTasksWithCloudState } from '../../cloud'
import { useStore } from '../../../state/appStore'

/** 把节点资产存入画廊（产生一条 done 任务卡），返回 taskId。 */
export async function saveNodeAsset(node: CanvasImageNode | CanvasVideoNode): Promise<string> {
  if (node.kind === 'image') {
    if (!node.imageId) throw new Error('节点没有图片内容')
    const dataUrl = await ensureImageCached(node.imageId)
    if (!dataUrl) throw new Error('原图不可用')
    const saved = await saveEditedToolImage(dataUrl, node.imageId, { taskPrompt: '画布图片存资产' })
    return saved.taskId
  }

  if (!node.videoId) throw new Error('节点没有视频内容')
  const record = await getVideo(node.videoId)
  if (!record) throw new Error('视频不可用')
  const posterDataUrl = node.posterImageId ? await ensureImageCached(node.posterImageId) : undefined
  if (!posterDataUrl) throw new Error('该视频缺少封面，暂不能存资产')
  const saved = await saveEditedToolVideo(record.blob, {
    name: record.name,
    posterDataUrl,
    duration: record.duration,
    width: record.width,
    height: record.height,
  })
  return saved.taskId
}

// 找到节点资产对应的任务：优先节点绑定的 taskId，其次按产出图/视频反查。
function findNodeTask(node: CanvasImageNode | CanvasVideoNode) {
  const tasks = useStore.getState().tasks
  if (node.taskId) {
    const task = tasks.find((t) => t.id === node.taskId)
    if (task) return task
  }
  if (node.kind === 'image' && node.imageId) {
    return tasks.find((t) => t.outputImages?.includes(node.imageId!))
  }
  if (node.kind === 'video' && node.videoId) {
    return tasks.find((t) => t.outputVideoIds?.includes(node.videoId!))
  }
  return undefined
}

/** 把节点资产保存到云端；没有关联任务时先"存资产"再入云。 */
export async function saveNodeToCloud(node: CanvasImageNode | CanvasVideoNode) {
  if (!getSub2Token()) throw new Error('请先连接 Sub2API 账号后再使用云储存')

  const existing = findNodeTask(node)
  const taskId = existing?.id ?? await saveNodeAsset(node)
  const task = useStore.getState().tasks.find((t) => t.id === taskId)
  if (!task) throw new Error('未找到可保存的任务')

  const result = await saveTasksWithCloudState([task])
  if (result.failed.length) {
    throw result.failed[0].error instanceof Error ? result.failed[0].error : new Error('云端保存失败')
  }
}

/** 下载节点资产文件。 */
export async function downloadNodeAsset(node: CanvasImageNode | CanvasVideoNode) {
  if (node.kind === 'image') {
    if (!node.imageId) throw new Error('节点没有图片内容')
    const result = await downloadImageIds([node.imageId], `canvas-${node.imageId.slice(0, 8)}`)
    if (!result.successCount) throw new Error('下载失败')
    return
  }

  if (!node.videoId) throw new Error('节点没有视频内容')
  const record = await getVideo(node.videoId)
  if (!record) throw new Error('视频不可用')
  const url = URL.createObjectURL(record.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = record.name || `canvas-video-${node.videoId}.mp4`
  a.click()
  URL.revokeObjectURL(url)
}
