import { useEffect, useRef, useState } from 'react'

interface CreativeToolsSectionProps {
  onEnter: () => void
}

interface Tool {
  key: string
  title: string
  group: '图片工具' | '视频工具' | '音频工具'
  desc: string
  cover: string
  accent: string
  /** 网格跨列/跨行，构成 bento 布局 */
  span: string
  tags: string[]
}

const tools: Tool[] = [
  {
    key: 'image-editor',
    title: '图片剪辑',
    group: '图片工具',
    desc: '裁切、局部重绘、扩图与图层合成，生成后的画面继续在同一张画布上打磨。',
    cover: '/tools/image-editor/cover.webp',
    accent: '#4da3ff',
    span: 'md:col-span-2 md:row-span-2',
    tags: ['局部重绘', '扩图', '图层'],
  },
  {
    key: 'background-remover',
    title: '一键抠图',
    group: '图片工具',
    desc: '本地模型秒级分离主体与背景，发丝级边缘，支持批量导出透明 PNG。',
    cover: '/tools/background-remover/cover.webp',
    accent: '#22d3ee',
    span: 'md:col-span-2',
    tags: ['发丝级边缘', '批量'],
  },
  {
    key: 'video-editor',
    title: '视频剪辑',
    group: '视频工具',
    desc: '多轨时间线，拼接生成片段、调速、转场与导出，直接衔接视频生成结果。',
    cover: '/tools/video-editor/cover.webp',
    accent: '#a3e635',
    span: 'md:col-span-2 md:row-span-2',
    tags: ['多轨时间线', '转场', '调速'],
  },
  {
    key: 'voice-studio',
    title: '音色工具',
    group: '音频工具',
    desc: '音色克隆与配音合成，为画面配上情绪贴合的旁白与角色声线。',
    cover: '/tools/voice-studio/cover.png',
    accent: '#f472b6',
    span: 'md:col-span-2',
    tags: ['音色克隆', 'TTS'],
  },
  {
    key: 'subtitle',
    title: '字幕识别',
    group: '音频工具',
    desc: '语音转写自动打轴，中英双语字幕一键生成并烧录进成片。',
    cover: '/tools/subtitle/cover.png',
    accent: '#fbbf24',
    span: 'md:col-span-3',
    tags: ['自动打轴', '双语'],
  },
  {
    key: 'resize',
    title: '尺寸调整',
    group: '图片工具',
    desc: '一稿多比例适配，16:9 / 9:16 / 1:1 智能重构图，主体永远在画面中心。',
    cover: '/tools/resize/cover.png',
    accent: '#e879f9',
    span: 'md:col-span-3',
    tags: ['智能重构图', '多比例'],
  },
]

function ToolCard({ tool, index, onEnter }: { tool: Tool; index: number; onEnter: () => void }) {
  return (
    <button
      type="button"
      onClick={onEnter}
      style={{
        '--accent': tool.accent,
        animationDelay: `${index * 70}ms`,
      } as React.CSSProperties}
      className={`group relative flex min-h-[7.5rem] flex-col justify-end overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 p-5 text-left transition-[border-color,box-shadow] duration-300 [contain:paint] hover:border-[color:var(--accent)] hover:shadow-[0_0_0_1px_var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-safe:animate-[landing-rise_.6s_cubic-bezier(.16,1,.3,1)_both] ${tool.span}`}
    >
      <img
        src={tool.cover || '/placeholder.svg'}
        alt=""
        aria-hidden="true"
        loading="lazy"
        className="absolute inset-0 h-full w-full scale-105 object-cover opacity-45 transition-all duration-700 group-hover:scale-110 group-hover:opacity-70"
      />
      <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/20" />
      {/* 悬停时的主色高光（固定位置，避免逐帧重绘） */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 [background:radial-gradient(260px_200px_at_20%_100%,color-mix(in_srgb,var(--accent)_28%,transparent),transparent_70%)]"
      />

      <div className="relative">
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-2.5 py-1 text-[10px] tracking-wide text-zinc-300 backdrop-blur-sm"
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: tool.accent }} />
          {tool.group}
        </span>
        <h3 className="mt-2.5 text-xl font-medium text-white md:text-2xl">{tool.title}</h3>
        <p className="mt-1.5 max-w-md text-pretty text-xs leading-relaxed text-zinc-400 md:text-sm">{tool.desc}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tool.tags.map((t) => (
            <span key={t} className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] text-zinc-300">
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* 右上角箭头 */}
      <span
        aria-hidden="true"
        className="absolute right-4 top-4 flex h-8 w-8 translate-y-1 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white opacity-0 backdrop-blur-sm transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M7 17L17 7M17 7H9M17 7v8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  )
}

export default function CreativeToolsSection({ onEnter }: CreativeToolsSectionProps) {
  const sectionRef = useRef<HTMLElement>(null)
  const [shown, setShown] = useState(false)

  /** 进入视口后再触发卡片入场动画 */
  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setShown(true),
      { threshold: 0.25 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <section
      ref={sectionRef}
      id="tools"
      data-snap-page
      className="relative flex h-svh snap-start scroll-mt-16 flex-col overflow-hidden bg-black"
      aria-label="创作工具"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background:radial-gradient(90%_70%_at_15%_0%,rgba(77,163,255,.16),transparent_60%),radial-gradient(80%_60%_at_90%_100%,rgba(163,230,53,.12),transparent_60%)]"
      />

      <div className="relative z-10 flex h-full flex-col justify-center gap-5 px-6 pb-10 pt-24 md:px-12">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-sky-400/80">Creative Tools</p>
            <h2 className="mt-2 text-3xl font-medium tracking-tight text-white md:text-5xl">
              <span className="text-balance">生成之后，才是创作的开始</span>
            </h2>
            <p className="mt-2 max-w-2xl text-pretty leading-relaxed text-zinc-400">
              图片、视频、音频工具全部内置在同一个工作台。素材不用��回导出导入，一条链路走到成片。
            </p>
          </div>
          <button
            type="button"
            onClick={onEnter}
            className="rounded-full bg-white px-6 py-3 text-sm font-medium text-black transition-transform hover:scale-[1.03] active:scale-95"
          >
            打开工作台
          </button>
        </header>

        <div className={`grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-6 md:grid-rows-3 ${shown ? '' : 'invisible'}`}>
          {tools.map((tool, i) => (
            <ToolCard key={tool.key} tool={tool} index={i} onEnter={onEnter} />
          ))}
        </div>
      </div>
    </section>
  )
}
