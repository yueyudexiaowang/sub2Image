import { useMemo, useRef, useState } from 'react'
import { MODE_LABEL, type ModelMode, type ModelSummary } from './modelCatalog'

interface ModelCapabilitiesSectionProps {
  models: ModelSummary[]
  loading: boolean
  fallback: boolean
  /** 点击模型卡片：带着该模型跳到定价试算 */
  onPickModel: (id: string) => void
}

type Filter = 'all' | 'video' | 'image'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部模型' },
  { key: 'video', label: '视频生成' },
  { key: 'image', label: '图像生成' },
]

const isVideoModel = (m: ModelSummary) => m.modes.some((mode) => mode.endsWith('-video'))

/** 取模型最低单价，用于卡片角标 */
function lowestPrice(model: ModelSummary) {
  if (!model.salePricing.length) return null
  return model.salePricing.reduce((min, p) => (p.price < min.price ? p : min), model.salePricing[0])
}

function ModelCard({ model, onPick }: { model: ModelSummary; onPick: () => void }) {
  const low = lowestPrice(model)
  const unitText = low?.unit === 'image' ? '/张' : low?.unit === 'call' ? '/次' : '/秒'

  return (
    <button
      type="button"
      onClick={onPick}
      style={{ '--accent': model.accent } as React.CSSProperties}
      className="group relative flex h-44 w-72 shrink-0 flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left backdrop-blur-sm transition-all duration-500 hover:-translate-y-1.5 hover:border-[color:var(--accent)] hover:bg-white/[0.07] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    >
      {/* 霓虹光晕 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-25 blur-3xl transition-opacity duration-500 group-hover:opacity-70"
        style={{ background: 'var(--accent)' }}
      />
      {/* 扫光 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/15 to-transparent transition-transform duration-[900ms] ease-out group-hover:translate-x-full"
      />

      <div className="relative">
        <div className="flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full transition-shadow duration-500 group-hover:shadow-[0_0_12px_3px_var(--accent)]"
            style={{ background: model.accent }}
          />
          <span className="truncate text-[11px] uppercase tracking-[0.2em] text-zinc-500">{model.vendor}</span>
        </div>
        <p className="mt-2 truncate text-lg font-medium text-white">{model.name}</p>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-400">{model.tagline}</p>
      </div>

      <div className="relative flex items-end justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {model.modes.slice(0, 2).map((mode) => (
            <span key={mode} className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-zinc-300">
              {MODE_LABEL[mode]}
            </span>
          ))}
          <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-zinc-300">
            {model.resolutions[model.resolutions.length - 1]}
          </span>
        </div>
        {low && (
          <span className="shrink-0 font-mono text-sm" style={{ color: model.accent }}>
            ${low.price.toFixed(3)}
            <span className="text-[10px] text-zinc-500">{unitText}</span>
          </span>
        )}
      </div>
    </button>
  )
}

/** 无限横向滚动跑马灯，鼠标悬停暂停 */
function MarqueeRow({
  models,
  reverse,
  duration,
  onPick,
}: {
  models: ModelSummary[]
  reverse?: boolean
  duration: number
  onPick: (id: string) => void
}) {
  if (!models.length) return null
  return (
    <div className="group/row relative overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
      <div
        className="flex w-max gap-4 motion-safe:animate-[landing-marquee_linear_infinite] motion-safe:group-hover/row:[animation-play-state:paused]"
        style={{ animationDuration: `${duration}s`, animationDirection: reverse ? 'reverse' : 'normal' }}
      >
        {[0, 1].map((copy) => (
          <div key={copy} className="flex gap-4" aria-hidden={copy === 1}>
            {models.map((model) => (
              <ModelCard key={`${copy}-${model.id}`} model={model} onPick={() => onPick(model.id)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ModelCapabilitiesSection({
  models,
  loading,
  fallback,
  onPickModel,
}: ModelCapabilitiesSectionProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const sectionRef = useRef<HTMLElement>(null)

  const visible = useMemo(() => {
    if (filter === 'video') return models.filter(isVideoModel)
    if (filter === 'image') return models.filter((m) => !isVideoModel(m))
    return models
  }, [models, filter])

  const rows = useMemo(() => {
    const mid = Math.ceil(visible.length / 2)
    return [visible.slice(0, mid), visible.slice(mid)]
  }, [visible])

  const stats = useMemo(() => {
    const modes = new Set<ModelMode>()
    const resolutions = new Set<string>()
    models.forEach((m) => {
      m.modes.forEach((mode) => modes.add(mode))
      m.resolutions.forEach((r) => resolutions.add(r))
    })
    return [
      { value: String(models.length), label: '可用模型' },
      { value: String(modes.size), label: '生成模式' },
      { value: String(resolutions.size), label: '输出规格' },
      { value: '1', label: '统一接口' },
    ]
  }, [models])

  /** 鼠标跟随的聚光灯 */
  const onMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    const el = sectionRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`)
    el.style.setProperty('--my', `${e.clientY - rect.top}px`)
  }

  return (
    <section
      ref={sectionRef}
      id="models"
      data-snap-page
      onMouseMove={onMouseMove}
      className="relative flex h-svh snap-start scroll-mt-16 flex-col overflow-hidden [background:radial-gradient(120%_100%_at_50%_-10%,#12386b_0%,#08203f_35%,#040a16_68%,#000_100%)]"
      aria-label="模型能力"
    >
      {/* 网格底纹 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgba(255,255,255,.28)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.28)_1px,transparent_1px)] [background-size:64px_64px] [mask-image:radial-gradient(80%_70%_at_50%_35%,#000,transparent)]"
      />
      {/* 聚光灯 */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70 [background:radial-gradient(320px_320px_at_var(--mx,50%)_var(--my,40%),rgba(77,163,255,.22),transparent_70%)]"
      />

      <div className="relative z-10 flex h-full flex-col justify-center gap-6 py-20">
        <header className="px-6 md:px-12">
          <p className="text-sm uppercase tracking-[0.3em] text-sky-400/80">Model Capabilities</p>
          <h2 className="mt-3 text-4xl font-medium tracking-tight text-white md:text-6xl">
            <span className="text-balance">一个入口，调度全部模型</span>
          </h2>
          <p className="mt-3 max-w-2xl text-pretty leading-relaxed text-zinc-400">
            视频与图像模型统一接入我的贾维斯。能力、分辨率与业务售价实时同步，切换模型不需要改工作流。
            {fallback && <span className="ml-2 text-xs text-amber-400/80">（当前展示示例目录）</span>}
          </p>
        </header>

        {/* 过滤胶囊 */}
        <div className="flex flex-wrap items-center gap-2 px-6 md:px-12">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`rounded-full border px-4 py-1.5 text-sm transition-all duration-200 active:scale-95 ${
                filter === f.key
                  ? 'border-white/60 bg-white text-black'
                  : 'border-white/15 text-zinc-300 hover:border-white/40 hover:text-white'
              }`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-1 font-mono text-xs text-zinc-500">{visible.length} MODELS</span>
        </div>

        {/* 跑马灯 */}
        <div className="flex flex-col gap-4">
          {loading ? (
            <div className="flex gap-4 px-6 md:px-12">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-44 w-72 shrink-0 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
              ))}
            </div>
          ) : (
            <>
              <MarqueeRow models={rows[0]} duration={64} onPick={onPickModel} />
              <MarqueeRow models={rows[1]} duration={78} reverse onPick={onPickModel} />
            </>
          )}
        </div>

        {/* 统计条 */}
        <dl className="grid grid-cols-2 gap-3 px-6 md:grid-cols-4 md:px-12">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <dt className="text-xs text-zinc-500">{s.label}</dt>
              <dd className="mt-0.5 font-mono text-2xl text-white">{s.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  )
}
