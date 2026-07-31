import { useEffect, useMemo, useState } from 'react'
import {
  MAX_DURATION,
  MIN_DURATION,
  MODE_LABEL,
  UNIT_LABEL,
  findPrice,
  formatUsd,
  round3,
  type ModelMode,
  type ModelSummary,
} from './modelCatalog'

interface PricingSectionProps {
  models: ModelSummary[]
  loading: boolean
  fallback: boolean
  /** 由模型能力页点击卡片带过来的模型 ID */
  selectedId: string
  onSelectId: (id: string) => void
  onEnter: () => void
}

/** 分辨率对应的基准像素尺寸，用于按比例推导 size 参数 */
const BASE_LONG_EDGE: Record<string, number> = {
  '480p': 854,
  '720p': 1280,
  '1080p': 1920,
  '1K': 1024,
  '2K': 2048,
  '4K': 4096,
}

/** 展示用汇率，与管理台默认全局汇率一致 */
const EXCHANGE_RATE = 7

function computeSize(resolution: string, ratio: string): string {
  const long = BASE_LONG_EDGE[resolution] ?? 1280
  const [rw, rh] = ratio.split(':').map(Number)
  if (!rw || !rh) return `${long} × ${long}`
  const even = (n: number) => Math.round(n / 2) * 2
  return rw >= rh
    ? `${even(long)} × ${even((long * rh) / rw)}`
    : `${even((long * rw) / rh)} × ${even(long)}`
}

/** 通用胶囊选择器 */
function OptionRow<T extends string | number>({
  label,
  options,
  value,
  onChange,
  render,
}: {
  label: string
  options: T[]
  value: T
  onChange: (v: T) => void
  render?: (v: T) => string
}) {
  if (!options.length) return null
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => (
          <button
            key={String(opt)}
            type="button"
            onClick={() => onChange(opt)}
            aria-pressed={opt === value}
            className={`rounded-lg border px-3 py-1.5 text-sm transition-all duration-200 active:scale-95 ${
              opt === value
                ? 'border-sky-400 bg-sky-400/15 text-white'
                : 'border-white/12 text-zinc-400 hover:border-white/35 hover:text-white'
            }`}
          >
            {render ? render(opt) : String(opt)}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function PricingSection({
  models,
  loading,
  fallback,
  selectedId,
  onSelectId,
  onEnter,
}: PricingSectionProps) {
  const model = useMemo(
    () => models.find((m) => m.id === selectedId) ?? models[0],
    [models, selectedId],
  )

  const [mode, setMode] = useState<ModelMode>('text-to-video')
  const [resolution, setResolution] = useState('720p')
  const [ratio, setRatio] = useState('16:9')
  const [duration, setDuration] = useState(5)
  const [quantity, setQuantity] = useState(1)

  /** 切换模型后，把不再支持的选项夹回合法范围 */
  useEffect(() => {
    if (!model) return
    setMode((prev) => (model.modes.includes(prev) ? prev : model.modes[0]))
    setResolution((prev) => (model.resolutions.includes(prev) ? prev : model.resolutions[0]))
    setRatio((prev) => (model.ratios.includes(prev) ? prev : model.ratios[0]))
    setDuration((prev) => {
      if (!model.durations.length) return prev
      return model.durations.includes(prev) ? prev : model.durations[Math.floor(model.durations.length / 2)]
    })
  }, [model])

  const pricing = model ? findPrice(model, mode, resolution) : undefined
  const perSecond = pricing?.unit === 'second'
  const isVideo = Boolean(model?.durations.length)
  const billedDuration = perSecond ? Math.min(Math.max(duration, MIN_DURATION), MAX_DURATION) : 1
  const unitTotal = pricing ? round3(pricing.price * billedDuration) : 0
  const total = round3(unitTotal * quantity)

  const lineItems = pricing
    ? [
        { label: `单价（${UNIT_LABEL[pricing.unit]}）`, value: formatUsd(pricing.price) },
        ...(perSecond ? [{ label: '时长', value: `${billedDuration} 秒` }] : []),
        { label: '单条小计', value: formatUsd(unitTotal) },
        { label: '数量', value: `× ${quantity}` },
      ]
    : []

  return (
    <section
      id="pricing"
      data-snap-page
      className="relative flex h-svh snap-start scroll-mt-16 flex-col overflow-hidden [background:radial-gradient(110%_90%_at_80%_0%,#0d2a4d_0%,#07172c_40%,#03080f_72%,#000_100%)]"
      aria-label="定价"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.14] [background-image:linear-gradient(rgba(255,255,255,.3)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.3)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(70%_60%_at_60%_40%,#000,transparent)]"
      />

      <div className="relative z-10 mx-auto flex h-full w-full max-w-7xl flex-col justify-center gap-4 px-6 pb-10 pt-24 md:px-12">
        <header>
          <p className="text-sm uppercase tracking-[0.3em] text-sky-400/80">Pricing</p>
          <h2 className="mt-2 text-4xl font-medium tracking-tight text-white md:text-5xl">
            <span className="text-balance">按 SKU 计费，先算清再开工</span>
          </h2>
          <p className="mt-2 max-w-2xl text-pretty leading-relaxed text-zinc-400">
            选择模型与生成参数，实时读取该 SKU 的业务售价并算出总价。用多少付多少，没有起充门槛。
            {fallback && <span className="ml-2 text-xs text-amber-400/80">（当前展示示例价格）</span>}
          </p>
        </header>

        {loading || !model ? (
          <div className="h-72 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
        ) : (
          <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[1fr_20rem] lg:grid-cols-[1fr_22rem]">
            {/* 左：参数配置 */}
            <div className="flex min-h-0 flex-col gap-5 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm md:p-6">
              <div className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">模型</span>
                <div className="flex flex-wrap gap-2">
                  {models.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSelectId(m.id)}
                      aria-pressed={m.id === model.id}
                      style={{ '--accent': m.accent } as React.CSSProperties}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-all duration-200 active:scale-95 ${
                        m.id === model.id
                          ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/15 text-white'
                          : 'border-white/12 text-zinc-400 hover:border-white/35 hover:text-white'
                      }`}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.accent }} />
                      {m.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <OptionRow
                  label="生成模式"
                  options={model.modes}
                  value={mode}
                  onChange={setMode}
                  render={(m) => MODE_LABEL[m]}
                />
                <OptionRow label="分辨率" options={model.resolutions} value={resolution} onChange={setResolution} />
                <OptionRow label="画面比例" options={model.ratios} value={ratio} onChange={setRatio} />
                {isVideo && (
                  <OptionRow
                    label={`时长（${MIN_DURATION}-${MAX_DURATION} 秒）`}
                    options={model.durations}
                    value={duration}
                    onChange={setDuration}
                    render={(d) => `${d}s`}
                  />
                )}
              </div>

              {/* 数量 */}
              <div className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-[0.18em] text-zinc-500">数量</span>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    aria-label="减少数量"
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/12 text-lg text-zinc-300 transition-colors hover:border-white/40 hover:text-white"
                  >
                    −
                  </button>
                  <span className="w-12 text-center font-mono text-xl text-white">{quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.min(50, q + 1))}
                    aria-label="增加数量"
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/12 text-lg text-zinc-300 transition-colors hover:border-white/40 hover:text-white"
                  >
                    +
                  </button>
                  <div className="ml-2 flex flex-wrap gap-1.5">
                    {[1, 4, 10].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setQuantity(n)}
                        className="rounded-md bg-white/8 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-white/20 hover:text-white"
                      >
                        {n} 条
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {model.highlights.length > 0 && (
                <p className="text-xs leading-relaxed text-zinc-500">
                  {model.vendor} · {model.highlights.join(' / ')}
                </p>
              )}
            </div>

            {/* 右：SKU 价格卡 */}
            <aside
              style={{ '--accent': model.accent } as React.CSSProperties}
              className="relative flex min-h-0 flex-col overflow-y-auto rounded-2xl border border-white/12 bg-black/50 p-5 backdrop-blur-md md:p-6"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -right-20 -top-20 h-52 w-52 rounded-full opacity-30 blur-3xl"
                style={{ background: 'var(--accent)' }}
              />

              <div className="relative">
                <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">SKU</p>
                <p className="mt-1.5 break-all font-mono text-sm text-white">
                  {model.id}
                  <span className="text-zinc-500">
                    {' · '}
                    {mode}
                    {' · '}
                    {resolution}
                    {isVideo ? ` · ${billedDuration}s` : ''}
                  </span>
                </p>

                <dl className="mt-5 flex flex-col gap-2 border-t border-white/10 pt-4 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-zinc-500">输出尺寸</dt>
                    <dd className="font-mono text-zinc-200">{computeSize(resolution, ratio)}</dd>
                  </div>
                  {lineItems.map((item) => (
                    <div key={item.label} className="flex justify-between gap-3">
                      <dt className="text-zinc-500">{item.label}</dt>
                      <dd className="font-mono text-zinc-200">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className="relative mt-auto border-t border-white/10 pt-5">
                {pricing ? (
                  <>
                    <p className="text-xs uppercase tracking-[0.2em] text-zinc-500">预计总价</p>
                    <p
                      key={`${model.id}-${mode}-${resolution}-${billedDuration}-${quantity}`}
                      className="mt-1 font-mono text-5xl leading-none text-white motion-safe:animate-[landing-price-pulse_.35s_ease-out_both]"
                    >
                      {formatUsd(total)}
                    </p>
                    <p className="mt-1.5 font-mono text-sm text-zinc-500">
                      ≈ ¥{round3(total * EXCHANGE_RATE).toFixed(2)} · 汇率 {EXCHANGE_RATE}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-amber-400/80">该模型暂未开放此组合的定价，请更换模式或分辨率。</p>
                )}

                <button
                  type="button"
                  onClick={onEnter}
                  className="mt-5 w-full rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.02] active:scale-95"
                >
                  用该配置开始创作
                </button>
                <p className="mt-2.5 text-center text-[11px] leading-relaxed text-zinc-600">
                  价格按 3 位小数处理，实际以下单时生成的报价单为准。
                </p>
              </div>
            </aside>
          </div>
        )}
      </div>
    </section>
  )
}
