import { useLayoutEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Sub2ComposerModelSelect from './Sub2ComposerModelSelect'

type Props = {
  onClose: () => void
}

/** 画布文本节点的生成设置：仅包含文本模型选择。 */
export default function Sub2CanvasTextComposerSettings({ onClose }: Props) {
  const [position, setPosition] = useState<React.CSSProperties>()

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
      <div className="cc-settings-popover" role="dialog" aria-label="文本设置" style={position} onClick={(e) => e.stopPropagation()}>
        <Sub2ComposerModelSelect kind="text" onRequestClose={onClose} />
      </div>
    </div>,
    document.body,
  )
}
