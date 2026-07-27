import type { ReactNode } from 'react'

interface SettingToggleRowProps {
  label: string
  description?: ReactNode
  checked: boolean
  disabled?: boolean
  onToggle: () => void
}

/** 设置页开关行：整行可点（扩大触控目标），开关本体保留 switch 语义供键盘/读屏使用。 */
export default function SettingToggleRow({ label, description, checked, disabled, onToggle }: SettingToggleRowProps) {
  return (
    <div className="block">
      <div
        className={`-mx-1.5 mb-1 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1 transition-colors ${disabled ? 'opacity-60' : 'cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-white/[0.04]'}`}
        onClick={() => {
          if (!disabled) onToggle()
        }}
      >
        <span className="block text-sm text-gray-600 dark:text-gray-300">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={label}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation()
            onToggle()
          }}
          className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${checked ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
        >
          <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
        </button>
      </div>
      {description != null && (
        <div data-selectable-text className="text-xs text-gray-500 dark:text-gray-500">
          {description}
        </div>
      )}
    </div>
  )
}
