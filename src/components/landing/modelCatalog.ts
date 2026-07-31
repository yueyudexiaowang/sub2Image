/**
 * 首页「模型能力 / 定价」板块的数据层。
 *
 * 线上优先读取适配器业务接口：
 *   GET /v1/models        获取可用模型列表（能力 + 业务售价）
 *   GET /v1/models/:id    获取单个模型的配置与售价
 * 接口不可用时（本地开发、未部署适配器）回退到内置示例目录，
 * 保证首页在任何环境下都能完整展示与试算。
 */

/**
 * 生成模式。`video-to-video` 对应 `POST /v1/videos/generations` 的 `video_urls` 入参，
 * 即以参考视频驱动的续写 / 风格重绘 / 运动迁移。
 */
export type ModelMode =
  | 'text-to-video'
  | 'image-to-video'
  | 'video-to-video'
  | 'text-to-image'
  | 'image-to-image'

export interface SalePricing {
  mode: ModelMode
  resolution: string
  unit: 'second' | 'image' | 'call'
  price: number
  currency: string
}

export interface ModelSummary {
  id: string
  name: string
  vendor: string
  tagline: string
  /** 卡片配色（十六进制），用于霓虹描边与光晕 */
  accent: string
  modes: ModelMode[]
  resolutions: string[]
  /** 支持的时长（秒），业务侧统一校验为 4-15 的整数 */
  durations: number[]
  ratios: string[]
  highlights: string[]
  salePricing: SalePricing[]
}

export const MODE_LABEL: Record<ModelMode, string> = {
  'text-to-video': '文生视频',
  'image-to-video': '图生视频',
  'video-to-video': '视频生视频',
  'text-to-image': '文生图',
  'image-to-image': '图生图',
}

export const UNIT_LABEL: Record<SalePricing['unit'], string> = {
  second: '每秒',
  image: '每张',
  call: '每次',
}

const seconds = (n: number) => n

/** 内置示例目录：接口不可用时的兜底数据 */
export const FALLBACK_MODELS: ModelSummary[] = [
  {
    id: 'seedance-2-0-pro',
    name: 'Seedance 2.0 Pro',
    vendor: 'ByteDance',
    tagline: '电影级运镜与长镜头稳定性，适合成片级叙事',
    accent: '#4da3ff',
    modes: ['text-to-video', 'image-to-video', 'video-to-video'],
    resolutions: ['480p', '720p', '1080p'],
    durations: [4, 5, 6, 8, 10, 12, 15],
    ratios: ['16:9', '9:16', '1:1', '21:9'],
    highlights: ['多镜头一致性', '物理运动自然', '参考视频续写'],
    salePricing: [
      { mode: 'text-to-video', resolution: '480p', unit: 'second', price: 0.412, currency: 'USD' },
      { mode: 'text-to-video', resolution: '720p', unit: 'second', price: 0.686, currency: 'USD' },
      { mode: 'text-to-video', resolution: '1080p', unit: 'second', price: 1.204, currency: 'USD' },
      { mode: 'image-to-video', resolution: '480p', unit: 'second', price: 0.446, currency: 'USD' },
      { mode: 'image-to-video', resolution: '720p', unit: 'second', price: 0.742, currency: 'USD' },
      { mode: 'image-to-video', resolution: '1080p', unit: 'second', price: 1.298, currency: 'USD' },
      { mode: 'video-to-video', resolution: '480p', unit: 'second', price: 0.483, currency: 'USD' },
      { mode: 'video-to-video', resolution: '720p', unit: 'second', price: 0.805, currency: 'USD' },
      { mode: 'video-to-video', resolution: '1080p', unit: 'second', price: 1.407, currency: 'USD' },
    ],
  },
  {
    id: 'seedance-2-0-mini',
    name: 'Seedance 2.0 Mini',
    vendor: 'ByteDance',
    tagline: '轻量快速版本，草稿与批量分镜的性价比之选',
    accent: '#38bdf8',
    modes: ['text-to-video'],
    resolutions: ['480p', '720p'],
    durations: [4, 5, 6, 8, 10],
    ratios: ['16:9', '9:16', '1:1'],
    highlights: ['出片速度快', '批量试镜友好', '成本可控'],
    salePricing: [
      { mode: 'text-to-video', resolution: '480p', unit: 'second', price: 0.386, currency: 'USD' },
      { mode: 'text-to-video', resolution: '720p', unit: 'second', price: 0.686, currency: 'USD' },
    ],
  },
  {
    id: 'veo-3-1',
    name: 'Veo 3.1',
    vendor: 'Google',
    tagline: '原生同期声与环境音，画面与声音一次生成',
    accent: '#a3e635',
    modes: ['text-to-video', 'image-to-video'],
    resolutions: ['720p', '1080p'],
    durations: [4, 6, 8],
    ratios: ['16:9', '9:16'],
    highlights: ['同期音轨', '语义理解强', '高保真材质'],
    salePricing: [
      { mode: 'text-to-video', resolution: '720p', unit: 'second', price: 1.05, currency: 'USD' },
      { mode: 'text-to-video', resolution: '1080p', unit: 'second', price: 1.68, currency: 'USD' },
      { mode: 'image-to-video', resolution: '720p', unit: 'second', price: 1.12, currency: 'USD' },
      { mode: 'image-to-video', resolution: '1080p', unit: 'second', price: 1.75, currency: 'USD' },
    ],
  },
  {
    id: 'veo-3-1-fast',
    name: 'Veo 3.1 Fast',
    vendor: 'Google',
    tagline: '同一模型族的加速档位，迭代节奏更快',
    accent: '#84cc16',
    modes: ['text-to-video', 'image-to-video'],
    resolutions: ['720p'],
    durations: [4, 6, 8],
    ratios: ['16:9', '9:16'],
    highlights: ['低延迟', '预览级画质', '适合多轮试错'],
    salePricing: [
      { mode: 'text-to-video', resolution: '720p', unit: 'second', price: 0.42, currency: 'USD' },
      { mode: 'image-to-video', resolution: '720p', unit: 'second', price: 0.455, currency: 'USD' },
    ],
  },
  {
    id: 'kling-v2-1-master',
    name: 'Kling 2.1 Master',
    vendor: '快手',
    tagline: '人物动作与表情细腻，人像类内容表现突出',
    accent: '#f472b6',
    modes: ['text-to-video', 'image-to-video', 'video-to-video'],
    resolutions: ['720p', '1080p'],
    durations: [5, 10],
    ratios: ['16:9', '9:16', '1:1'],
    highlights: ['人物动作自然', '面部一致性', '动作迁移'],
    salePricing: [
      { mode: 'text-to-video', resolution: '720p', unit: 'second', price: 0.56, currency: 'USD' },
      { mode: 'text-to-video', resolution: '1080p', unit: 'second', price: 0.98, currency: 'USD' },
      { mode: 'image-to-video', resolution: '720p', unit: 'second', price: 0.63, currency: 'USD' },
      { mode: 'image-to-video', resolution: '1080p', unit: 'second', price: 1.05, currency: 'USD' },
      { mode: 'video-to-video', resolution: '720p', unit: 'second', price: 0.686, currency: 'USD' },
      { mode: 'video-to-video', resolution: '1080p', unit: 'second', price: 1.134, currency: 'USD' },
    ],
  },
  {
    id: 'hailuo-02',
    name: 'Hailuo 02',
    vendor: 'MiniMax',
    tagline: '动态幅度大，擅长夸张运动与镜头冲击力',
    accent: '#fb923c',
    modes: ['text-to-video', 'image-to-video', 'video-to-video'],
    resolutions: ['720p', '1080p'],
    durations: [6, 10],
    ratios: ['16:9', '9:16'],
    highlights: ['大幅度运动', '镜头张力强', '视频续写'],
    salePricing: [
      { mode: 'text-to-video', resolution: '720p', unit: 'second', price: 0.49, currency: 'USD' },
      { mode: 'text-to-video', resolution: '1080p', unit: 'second', price: 0.84, currency: 'USD' },
      { mode: 'image-to-video', resolution: '720p', unit: 'second', price: 0.532, currency: 'USD' },
      { mode: 'image-to-video', resolution: '1080p', unit: 'second', price: 0.91, currency: 'USD' },
      { mode: 'video-to-video', resolution: '720p', unit: 'second', price: 0.581, currency: 'USD' },
      { mode: 'video-to-video', resolution: '1080p', unit: 'second', price: 0.98, currency: 'USD' },
    ],
  },
  {
    id: 'wan-2-5',
    name: 'Wan 2.5',
    vendor: '阿里',
    tagline: '开源生态友好，风格迁移与控制项丰富',
    accent: '#22d3ee',
    modes: ['text-to-video', 'image-to-video', 'video-to-video'],
    resolutions: ['480p', '720p', '1080p'],
    durations: [4, 5, 8, 10],
    ratios: ['16:9', '9:16', '1:1'],
    highlights: ['可控性强', '视频风格重绘', '性价比高'],
    salePricing: [
      { mode: 'text-to-video', resolution: '480p', unit: 'second', price: 0.28, currency: 'USD' },
      { mode: 'text-to-video', resolution: '720p', unit: 'second', price: 0.462, currency: 'USD' },
      { mode: 'text-to-video', resolution: '1080p', unit: 'second', price: 0.812, currency: 'USD' },
      { mode: 'image-to-video', resolution: '480p', unit: 'second', price: 0.315, currency: 'USD' },
      { mode: 'image-to-video', resolution: '720p', unit: 'second', price: 0.504, currency: 'USD' },
      { mode: 'image-to-video', resolution: '1080p', unit: 'second', price: 0.875, currency: 'USD' },
      { mode: 'video-to-video', resolution: '480p', unit: 'second', price: 0.336, currency: 'USD' },
      { mode: 'video-to-video', resolution: '720p', unit: 'second', price: 0.539, currency: 'USD' },
      { mode: 'video-to-video', resolution: '1080p', unit: 'second', price: 0.945, currency: 'USD' },
    ],
  },
  {
    id: 'sora-2-pro',
    name: 'Sora 2 Pro',
    vendor: 'OpenAI',
    tagline: '长时序理解与世界一致性，复杂场景稳定',
    accent: '#e879f9',
    modes: ['text-to-video', 'image-to-video'],
    resolutions: ['720p', '1080p'],
    durations: [4, 8, 12, 15],
    ratios: ['16:9', '9:16', '1:1'],
    highlights: ['世界一致性', '长镜头', '复杂交互场景'],
    salePricing: [
      { mode: 'text-to-video', resolution: '720p', unit: 'second', price: 1.26, currency: 'USD' },
      { mode: 'text-to-video', resolution: '1080p', unit: 'second', price: 2.1, currency: 'USD' },
      { mode: 'image-to-video', resolution: '720p', unit: 'second', price: 1.33, currency: 'USD' },
      { mode: 'image-to-video', resolution: '1080p', unit: 'second', price: 2.24, currency: 'USD' },
    ],
  },
  {
    id: 'grok-imagine-video',
    name: 'Grok Imagine',
    vendor: 'xAI',
    tagline: '速度极快的创意短片，适合社交内容',
    accent: '#94a3b8',
    modes: ['text-to-video', 'image-to-video'],
    resolutions: ['480p', '720p'],
    durations: [4, 6],
    ratios: ['16:9', '9:16', '1:1'],
    highlights: ['秒级响应', '创意脑洞', '短视频比例'],
    salePricing: [
      { mode: 'text-to-video', resolution: '480p', unit: 'second', price: 0.196, currency: 'USD' },
      { mode: 'text-to-video', resolution: '720p', unit: 'second', price: 0.322, currency: 'USD' },
      { mode: 'image-to-video', resolution: '480p', unit: 'second', price: 0.217, currency: 'USD' },
      { mode: 'image-to-video', resolution: '720p', unit: 'second', price: 0.35, currency: 'USD' },
    ],
  },
  {
    id: 'nano-banana-2',
    name: 'Nano Banana 2',
    vendor: 'Google',
    tagline: '图像生成与多轮编辑，指令跟随精准',
    accent: '#fbbf24',
    modes: ['text-to-image', 'image-to-image'],
    resolutions: ['1K', '2K', '4K'],
    durations: [],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    highlights: ['多轮局部编辑', '文字排版准确', '参考图一致性'],
    salePricing: [
      { mode: 'text-to-image', resolution: '1K', unit: 'image', price: 0.042, currency: 'USD' },
      { mode: 'text-to-image', resolution: '2K', unit: 'image', price: 0.077, currency: 'USD' },
      { mode: 'text-to-image', resolution: '4K', unit: 'image', price: 0.154, currency: 'USD' },
      { mode: 'image-to-image', resolution: '1K', unit: 'image', price: 0.049, currency: 'USD' },
      { mode: 'image-to-image', resolution: '2K', unit: 'image', price: 0.084, currency: 'USD' },
      { mode: 'image-to-image', resolution: '4K', unit: 'image', price: 0.168, currency: 'USD' },
    ],
  },
  {
    id: 'seedream-4-0',
    name: 'Seedream 4.0',
    vendor: 'ByteDance',
    tagline: '中文语义理解出色的高质量图像模型',
    accent: '#60a5fa',
    modes: ['text-to-image', 'image-to-image'],
    resolutions: ['1K', '2K', '4K'],
    durations: [],
    ratios: ['16:9', '9:16', '1:1', '3:2', '2:3'],
    highlights: ['中文提示词', '海报级构图', '批量出图'],
    salePricing: [
      { mode: 'text-to-image', resolution: '1K', unit: 'image', price: 0.021, currency: 'USD' },
      { mode: 'text-to-image', resolution: '2K', unit: 'image', price: 0.042, currency: 'USD' },
      { mode: 'text-to-image', resolution: '4K', unit: 'image', price: 0.098, currency: 'USD' },
      { mode: 'image-to-image', resolution: '1K', unit: 'image', price: 0.028, currency: 'USD' },
      { mode: 'image-to-image', resolution: '2K', unit: 'image', price: 0.049, currency: 'USD' },
      { mode: 'image-to-image', resolution: '4K', unit: 'image', price: 0.105, currency: 'USD' },
    ],
  },
  {
    id: 'flux-2-pro',
    name: 'FLUX.2 Pro',
    vendor: 'Black Forest Labs',
    tagline: '摄影质感与细节层次，商用出图首选',
    accent: '#f87171',
    modes: ['text-to-image', 'image-to-image'],
    resolutions: ['1K', '2K'],
    durations: [],
    ratios: ['16:9', '9:16', '1:1', '4:3'],
    highlights: ['摄影级质感', '光影层次', '细节还原'],
    salePricing: [
      { mode: 'text-to-image', resolution: '1K', unit: 'image', price: 0.035, currency: 'USD' },
      { mode: 'text-to-image', resolution: '2K', unit: 'image', price: 0.063, currency: 'USD' },
      { mode: 'image-to-image', resolution: '1K', unit: 'image', price: 0.042, currency: 'USD' },
      { mode: 'image-to-image', resolution: '2K', unit: 'image', price: 0.07, currency: 'USD' },
    ],
  },
]

/** 时长业务约束：整数 4 - 15 秒 */
export const MIN_DURATION = seconds(4)
export const MAX_DURATION = seconds(15)

interface RawModel {
  id?: string
  name?: string
  vendor?: string
  modes?: string[]
  resolutions?: string[]
  salePricing?: SalePricing[]
}

const ACCENTS = ['#4da3ff', '#38bdf8', '#a3e635', '#f472b6', '#fb923c', '#22d3ee', '#e879f9', '#fbbf24']

/** 把接口返回的原始模型对象规整成首页使用的结构 */
function normalize(raw: RawModel, index: number): ModelSummary | null {
  if (!raw?.id) return null
  const modes = (raw.modes ?? []).filter((m): m is ModelMode => m in MODE_LABEL)
  const pricing = Array.isArray(raw.salePricing) ? raw.salePricing : []
  const fallback = FALLBACK_MODELS.find((m) => m.id === raw.id)
  const isVideo = modes.some((m) => m.endsWith('-video'))

  return {
    id: raw.id,
    name: raw.name ?? fallback?.name ?? raw.id,
    vendor: raw.vendor ?? fallback?.vendor ?? '—',
    tagline: fallback?.tagline ?? '通过我的贾维斯统一调用的生成模型',
    accent: fallback?.accent ?? ACCENTS[index % ACCENTS.length],
    modes: modes.length ? modes : (fallback?.modes ?? ['text-to-video']),
    resolutions: raw.resolutions?.length ? raw.resolutions : (fallback?.resolutions ?? ['720p']),
    // 接口不返回 durations，按业务约束生成 4-15 的整数区间
    durations: isVideo ? Array.from({ length: MAX_DURATION - MIN_DURATION + 1 }, (_, i) => MIN_DURATION + i) : [],
    ratios: fallback?.ratios ?? ['16:9', '9:16', '1:1'],
    highlights: fallback?.highlights ?? [],
    salePricing: pricing.length ? pricing : (fallback?.salePricing ?? []),
  }
}

export interface ModelCatalogResult {
  models: ModelSummary[]
  /** true 表示使用了内置示例目录（接口未接入或不可达） */
  fallback: boolean
}

/** 拉取模型目录，失败时静默回退到内置示例数据 */
export async function fetchModelCatalog(signal?: AbortSignal): Promise<ModelCatalogResult> {
  try {
    const res = await fetch('/v1/models', { signal, headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as { data?: RawModel[] } | RawModel[]
    const list = Array.isArray(json) ? json : (json.data ?? [])
    const models = list.map(normalize).filter((m): m is ModelSummary => Boolean(m))
    if (!models.length) throw new Error('空目录')
    return { models, fallback: false }
  } catch {
    return { models: FALLBACK_MODELS, fallback: true }
  }
}

/** 按模式 + 分辨率查找业务售价 */
export function findPrice(model: ModelSummary, mode: ModelMode, resolution: string): SalePricing | undefined {
  return (
    model.salePricing.find((p) => p.mode === mode && p.resolution === resolution) ??
    model.salePricing.find((p) => p.mode === mode)
  )
}

/** 统一按 3 位小数处理金额 */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function formatUsd(value: number): string {
  return `$${round3(value).toFixed(3)}`
}
