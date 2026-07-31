import { useEffect, useMemo, useRef, useState } from 'react'
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
      className="group relative flex h-44 w-72 shrink-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0f18] p-5 text-left transition-[border-color,box-shadow] duration-300 [contain:paint] hover:border-[color:var(--accent)] hover:shadow-[0_0_0_1px_var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    >
      {/* 角落主色晕染：用径向渐变代替 blur 滤镜，避免跑马灯滚动时逐帧重绘 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-40 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: 'radial-gradient(120px 100px at 100% 0%, color-mix(in srgb, var(--accent) 28%, transparent), transparent 70%)' }}
      />
      {/* 底部渐隐强调线 */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px scale-x-0 opacity-0 transition-all duration-500 group-hover:scale-x-100 group-hover:opacity-100"
        style={{ background: 'linear-gradient(90deg,transparent,var(--accent),transparent)' }}
      />

      {/* 头部：厂商 */}
      <div className="relative flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full transition-shadow duration-300 group-hover:shadow-[0_0_10px_2px_var(--accent)]"
          style={{ background: model.accent }}
        />
        <span className="truncate text-[11px] uppercase tracking-[0.2em] text-zinc-500">{model.vendor}</span>
      </div>

      {/* 主体：名称 + 描述 */}
      <p className="relative mt-2 truncate text-lg font-medium text-white">{model.name}</p>
      <p className="relative mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-400">{model.tagline}</p>

      {/*
        底部两行：模式标签独占一行（最多三种模式，挤在价格同一行会溢出），
        分辨率与价格并列在下一行。
      */}
      <div className="relative mt-auto flex flex-col gap-2 border-t border-white/8 pt-3">
        <div className="flex min-w-0 items-center gap-1 overflow-hidden">
          {model.modes.map((mode) => (
            <span
              key={mode}
              className="shrink-0 rounded-full border border-white/12 bg-white/[0.04] px-1.5 py-0.5 text-[10px] leading-none text-zinc-300"
            >
              {MODE_LABEL[mode]}
            </span>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="shrink-0 rounded-full border border-white/12 bg-white/[0.04] px-2 py-0.5 text-[10px] leading-none text-zinc-400">
            {model.resolutions[model.resolutions.length - 1]}
          </span>
          {low && (
            <span className="shrink-0 whitespace-nowrap font-mono text-sm" style={{ color: model.accent }}>
              ${low.price.toFixed(3)}
              <span className="text-[10px] text-zinc-500">{unitText}</span>
            </span>
          )}
        </div>
      </div>
    </button>
  )
}

/** 无限横向滚动跑马灯，鼠标悬停暂停 */
function MarqueeRow({
  models,
  reverse,
  duration,
  running,
  onPick,
}: {
  models: ModelSummary[]
  reverse?: boolean
  duration: number
  /** 本屏不可见时暂停动画，避免离屏也占用合成线程 */
  running: boolean
  onPick: (id: string) => void
}) {
  if (!models.length) return null
  return (
    <div className="group/row relative overflow-x-clip py-2 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
      <div
        className="flex w-max gap-4 motion-safe:animate-[landing-marquee_linear_infinite] motion-safe:group-hover/row:[animation-play-state:paused]"
        style={{
          animationDuration: `${duration}s`,
          animationDirection: reverse ? 'reverse' : 'normal',
          animationPlayState: running ? 'running' : 'paused',
        }}
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
  const [inView, setInView] = useState(false)

  /**
   * 跑马灯只在本屏可见时运行。
   * 24 张卡片的常驻 transform 动画即使离屏也会占用合成线程，是滚动掉帧的主因之一。
   */
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => setInView(entries[0]?.isIntersecting ?? false), {
      rootMargin: '200px 0px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

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
    // 全目录中按秒计费的最低单价，作为「起价」钩子
    const perSecond = models.flatMap((m) => m.salePricing.filter((p) => p.unit === 'second').map((p) => p.price))
    const floor = perSecond.length ? Math.min(...perSecond) : null

    const list: { value: string; unit: string; label: string; desc: string; accent?: boolean }[] = [
      { value: String(models.length), unit: '个', label: '可用模型', desc: '视频 + 图像，持续接入' },
      { value: String(modes.size), unit: '类', label: '生成模式', desc: '文生 / 图生 / 视频生视频' },
      { value: String(resolutions.size), unit: '档', label: '输出规格', desc: '480p 起，最高 4K' },
      ...(floor !== null
        ? [{ value: `$${floor.toFixed(3)}`, unit: '/秒', label: '最低起价', desc: '按秒计费，用多少付多少', accent: true }]
        : []),
    ]
    return list
  }, [models])

  return (
    <section
      ref={sectionRef}
      id="models"
      data-snap-page
      className="landing-page-section relative flex h-svh snap-start scroll-mt-16 flex-col overflow-hidden [background:radial-gradient(120%_100%_at_50%_-10%,#12386b_0%,#08203f_35%,#040a16_68%,#000_100%)]"
      aria-label="模型能力"
    >
      <div className="relative z-10 flex h-full flex-col justify-center gap-5 py-16">
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
              <MarqueeRow models={rows[0]} duration={64} running={inView} onPick={onPickModel} />
              <MarqueeRow models={rows[1]} duration={78} reverse running={inView} onPick={onPickModel} />
            </>
          )}
        </div>

        {/* 统计条：无边框社论式指标行，靠细分隔线区隔 */}
        <div className="px-6 md:px-12">
          <dl className="grid grid-cols-2 gap-y-6 border-t border-white/10 pt-6 md:grid-cols-4">
            {stats.map((s, i) => (
              <div
                key={s.label}
                className={`flex flex-col gap-1.5 px-1 md:px-6 ${i > 0 ? 'md:border-l md:border-white/10' : ''} ${
                  i % 2 === 1 ? 'border-l border-white/10 pl-5 md:pl-6' : ''
                }`}
              >
                <dt className="text-[11px] uppercase tracking-[0.22em] text-zinc-500">{s.label}</dt>
                <dd className="flex items-baseline gap-1">
                  <span
                    className={`font-mono text-[2.25rem] font-light leading-none tabular-nums ${
                      s.accent ? 'text-sky-300' : 'text-white'
                    }`}
                  >
                    {s.value}
                  </span>
                  <span className={`text-xs ${s.accent ? 'text-sky-400/70' : 'text-zinc-500'}`}>{s.unit}</span>
                </dd>
                <p className="text-[11px] leading-relaxed text-zinc-600">{s.desc}</p>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  )
}
