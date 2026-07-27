import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { getAgentVideoApiProfile } from '../../lib/apiProfiles'
import { useStore } from '../../store'
import { getVideoProvider, resolveVideoProviderId, type VideoParams, type VideoProfile } from '../../videoIntegrations'
import { LandscapeIcon, PortraitIcon } from '../../components/ui/icons'
import Sub2ComposerModelSelect from './Sub2ComposerModelSelect'
import Sub2GenerationModeTabs from './Sub2GenerationModeTabs'

type Props = {
  mode?: 'image' | 'video'
  onModeChange?: (mode: 'image' | 'video') => void
  params: VideoParams
  onChange: (params: VideoParams) => void
  onClose: () => void
}

export default function Sub2VideoComposerSettings({ mode, onModeChange, params, onChange, onClose }: Props) {
  const settings = useStore((state) => state.settings)
  const profile = getAgentVideoApiProfile(settings)
  const config = settings.sub2Configs.find((item) => item.profileId === profile?.id)
  const providerId = resolveVideoProviderId(config?.platform, profile?.model)
  const capabilities = useMemo(() => {
    const videoProfile: VideoProfile = {
      id: profile?.id || '',
      name: profile?.name || '',
      provider: providerId,
      baseUrl: profile?.baseUrl || '',
      apiKey: profile?.apiKey || '',
      model: profile?.model || '',
      timeout: profile?.timeout || 600,
    }
    return getVideoProvider(providerId).getCapabilities(videoProfile)
  }, [profile, providerId])
  const [position, setPosition] = useState<React.CSSProperties>()

  useEffect(() => {
    const duration = capabilities.durations.includes(params.duration) ? params.duration : capabilities.durations[0]
    const aspectRatio = capabilities.aspectRatios.includes(params.aspectRatio) ? params.aspectRatio : capabilities.aspectRatios[0]
    const resolution = capabilities.resolutions.includes(params.resolution) ? params.resolution : capabilities.resolutions[0]
    if (duration === params.duration && aspectRatio === params.aspectRatio && resolution === params.resolution) return
    onChange({ ...params, duration, aspectRatio, resolution })
  }, [capabilities, onChange, params])

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
      <div className="cc-settings-popover" role="dialog" aria-label="视频设置" style={position} onClick={(e) => e.stopPropagation()}>
        {mode && onModeChange && <Sub2GenerationModeTabs value={mode} onChange={onModeChange} />}
        <VideoOptionGroup
          label="时长"
          value={params.duration}
          options={capabilities.durations.map((duration) => ({ label: `${duration} 秒`, value: duration }))}
          columns={6}
          onChange={(duration) => {
            const value = Number(duration)
            const resolution = value !== 8 && (params.resolution === '1080p' || params.resolution === '4k')
              ? '720p'
              : params.resolution
            onChange({ ...params, duration: value, resolution })
          }}
        />
        <VideoOptionGroup
          label="生成数量"
          value={params.n}
          options={[1, 2, 3, 4].map((n) => ({ label: `${n} 个`, value: n }))}
          columns={4}
          onChange={(n) => onChange({ ...params, n: Number(n) })}
        />
        <VideoOptionGroup
          label="画面比例"
          value={params.aspectRatio}
          options={capabilities.aspectRatios.map((aspectRatio) => ({
            label: aspectRatio,
            value: aspectRatio,
            icon: aspectRatio === '9:16' ? <PortraitIcon /> : <LandscapeIcon />,
          }))}
          columns={2}
          onChange={(aspectRatio) => onChange({ ...params, aspectRatio: String(aspectRatio) })}
        />
        <VideoOptionGroup
          label="清晰度"
          value={params.resolution}
          options={capabilities.resolutions.map((resolution) => ({ label: resolution, value: resolution }))}
          columns={2}
          onChange={(resolution) => {
            const value = String(resolution)
            onChange({
              ...params,
              resolution: value,
              duration: value === '1080p' || value === '4k' ? 8 : params.duration,
            })
          }}
        />
        <Sub2ComposerModelSelect kind="video" onRequestClose={onClose} />
      </div>
    </div>,
    document.body,
  )
}

function VideoOptionGroup({
  label,
  value,
  options,
  columns,
  onChange,
}: {
  label: string
  value: string | number
  options: Array<{ label: string; value: string | number; icon?: ReactNode }>
  columns: number
  onChange: (value: string | number) => void
}) {
  return (
    <div className="cc-settings-segmented cc-settings-options-grid cc-settings-wide" role="group" aria-label={label} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'is-active' : ''}
          aria-label={`${label} ${option.label}`}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.icon && <span className="cc-settings-option-icon" aria-hidden="true">{option.icon}</span>}
          {option.label}
        </button>
      ))}
    </div>
  )
}
