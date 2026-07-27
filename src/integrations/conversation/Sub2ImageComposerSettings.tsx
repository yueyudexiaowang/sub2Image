import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getOutputImageLimitForSettings } from '../../lib/paramCompatibility'
import { calculateImageSize, normalizeImageSize, type SizeTier } from '../../lib/size'
import { useStore } from '../../store'
import type { TaskParams } from '../../types'
import Sub2ComposerModelSelect from './Sub2ComposerModelSelect'
import Sub2GenerationModeTabs from './Sub2GenerationModeTabs'

type Props = {
  mode?: 'image' | 'video'
  onModeChange?: (mode: 'image' | 'video') => void
  onClose: () => void
  onSaved?: () => void
}

const tiers: SizeTier[] = ['1K', '2K', '4K']
const ratios = [
  { label: '16:9', value: '16:9' },
  { label: '4:3', value: '4:3' },
  { label: '1:1', value: '1:1' },
  { label: '3:4', value: '3:4' },
  { label: '9:16', value: '9:16' },
] as const

function getSizePreset(size: string) {
  const current = normalizeImageSize(size)
  for (const tier of tiers) {
    for (const ratio of ratios) {
      if (calculateImageSize(tier, ratio.value) === current) return { tier, ratio: ratio.value }
    }
  }
  return null
}

export default function Sub2ImageComposerSettings({ mode, onModeChange, onClose, onSaved }: Props) {
  const params = useStore((state) => state.params)
  const settings = useStore((state) => state.settings)
  const setParams = useStore((state) => state.setParams)
  const limit = getOutputImageLimitForSettings(settings)
  const preset = getSizePreset(params.size)
  const [position, setPosition] = useState<React.CSSProperties>()

  const patch = (next: Partial<TaskParams>) => {
    setParams(next)
    onSaved?.()
  }

  const selectRatio = (ratio: string) => {
    const size = calculateImageSize(preset?.tier ?? '1K', ratio)
    if (size) patch({ size })
  }

  const selectTier = (tier: SizeTier) => {
    const size = calculateImageSize(tier, preset?.ratio ?? '1:1')
    if (size) patch({ size })
  }

  useLayoutEffect(() => {
    const trigger = document.querySelector('[data-composer-settings-trigger]')
    const dock = document.querySelector('[data-conversation-composer-dock]')
    if (!trigger) return

    const update = () => {
      const rect = trigger.getBoundingClientRect()
      setPosition({
        '--cc-popover-right': `${Math.max(window.innerWidth - rect.right, 8)}px`,
        '--cc-popover-bottom': `${Math.max(window.innerHeight - rect.top + 8, 8)}px`,
      } as React.CSSProperties)
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(trigger)
    if (dock) observer.observe(dock)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  return createPortal(
    <div className="cc-settings-overlay" data-composer-settings onClick={onClose}>
      <div
        className="cc-settings-popover"
        role="dialog"
        aria-label="图片设置"
        style={position}
        onClick={(e) => e.stopPropagation()}
      >
        {mode && onModeChange && <Sub2GenerationModeTabs value={mode} onChange={onModeChange} />}

        <div className="cc-settings-ratio-row" role="group" aria-label="图像比例">
          <button
            type="button"
            className={params.size === 'auto' ? 'is-active' : 'is-auto'}
            aria-label="比例 自动"
            aria-pressed={params.size === 'auto'}
            onClick={() => patch({ size: 'auto' })}
          >
            <strong>自动</strong>
          </button>
          {ratios.map((ratio) => {
            const [width, height] = ratio.value.split(':').map(Number)
            const active = preset?.ratio === ratio.value
            return (
              <button
                key={ratio.value}
                type="button"
                className={active ? 'is-active' : ''}
                aria-label={`比例 ${ratio.label}`}
                aria-pressed={active}
                onClick={() => selectRatio(ratio.value)}
              >
                <span className="cc-settings-ratio-icon" aria-hidden="true">
                  <span
                    style={{
                      aspectRatio: `${width} / ${height}`,
                      ...(width >= height ? { width: '100%' } : { height: '100%' }),
                    }}
                  />
                </span>
                <strong>{ratio.label}</strong>
              </button>
            )
          })}
        </div>

        <div
          className="cc-settings-segmented cc-settings-wide"
          role="group"
          aria-label="分辨率"
          style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}
        >
          <button
            type="button"
            className={params.size === 'auto' ? 'is-active' : ''}
            aria-label="分辨率 自动"
            aria-pressed={params.size === 'auto'}
            onClick={() => patch({ size: 'auto' })}
          >
            自动
          </button>
          {tiers.map((tier) => (
            <button
              key={tier}
              type="button"
              className={preset?.tier === tier ? 'is-active' : ''}
              aria-label={`分辨率 ${tier}`}
              aria-pressed={preset?.tier === tier}
              onClick={() => selectTier(tier)}
            >
              {tier}
            </button>
          ))}
        </div>

        <OptionGroup
          label="生成数量"
          value={params.n}
          options={[1, 2, 3, 4].map((count) => ({ label: count === 1 ? '1x' : `x${count}`, value: count }))}
          disabled={(value) => Number(value) > limit}
          onChange={(value) => patch({ n: Number(value) })}
        />
        <OptionGroup
          label="格式"
          value={params.output_format}
          options={[
            { label: 'PNG', value: 'png' },
            { label: 'JPEG', value: 'jpeg' },
            { label: 'WebP', value: 'webp' },
          ]}
          onChange={(value) => patch({ output_format: value as TaskParams['output_format'] })}
        />
        <div className="cc-settings-transparent-row" role="group" aria-label="透明背景">
          {[
            { label: '关闭', value: false, preview: 'is-off' },
            { label: '开启', value: true, preview: '' },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              className={params.transparent_output === option.value ? 'is-active' : ''}
              aria-label={`透明背景 ${option.label}`}
              aria-pressed={params.transparent_output === option.value}
              onClick={() => patch({ transparent_output: option.value })}
            >
              <span className={`cc-transparent-preview ${option.preview}`.trim()} aria-hidden="true"><span /></span>
              <strong>{option.label}</strong>
            </button>
          ))}
        </div>
        <Sub2ComposerModelSelect kind="image" onRequestClose={onClose} />
      </div>
    </div>,
    document.body,
  )
}

function OptionGroup({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: string | number
  options: Array<{ label: string; value: string | number }>
  disabled?: (value: string | number) => boolean
  onChange: (value: string | number) => void
}) {
  return (
    <div
      className="cc-settings-segmented cc-settings-wide"
      role="group"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'is-active' : ''}
          aria-label={`${label} ${option.label}`}
          aria-pressed={option.value === value}
          disabled={disabled?.(option.value)}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
