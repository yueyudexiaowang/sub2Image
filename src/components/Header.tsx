import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { navigateToExtensionWorkspace } from '../ExtensionWorkspace'
import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import ViewportTooltip from './ui/ViewportTooltip'
import { AiLiquidModeSwitch } from './aiLiquidModeSwitch'
import { navigateToCanvas } from '../features/canvas'
import HelpModal from './HelpModal'
import { useFavoriteCollectionTitle } from './FavoriteCollections'
import { CodeIcon, HelpCircleIcon, InstallIcon, SettingsIcon } from './ui/icons'
import GalleryHeaderControls from '../features/gallery/components/GalleryHeaderControls'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isInstalledPwa() {
  const nav = window.navigator as Navigator & { standalone?: boolean }
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true
}

export default function Header() {
  const appMode = useStore((s) => s.appMode)
  const setAppMode = useStore((s) => s.setAppMode)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const agentMobileHeaderVisible = useStore((s) => s.agentMobileHeaderVisible)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const favoriteCollectionTitle = useFavoriteCollectionTitle()
  const showFavoriteCollectionTitle = appMode === 'gallery' && Boolean(activeFavoriteCollectionId)
  const [showHelp, setShowHelp] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isPwaInstalled, setIsPwaInstalled] = useState(isInstalledPwa)
  const [hintVisible, setHintVisible] = useState(false)
  const [gallerySearchFocused, setGallerySearchFocused] = useState(false)
  const headerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (appMode !== 'gallery') setGallerySearchFocused(false)
  }, [appMode])

  // 对话功能暂时隐藏：持久化状态若停留在 agent，强制回到画廊。
  useEffect(() => {
    if (appMode === 'agent') setAppMode('gallery')
  }, [appMode, setAppMode])

  useEffect(() => {
    if (appMode === 'agent' && !agentMobileHeaderVisible) {
      setHintVisible(true)
      const timer = setTimeout(() => {
        setHintVisible(false)
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [appMode, agentMobileHeaderVisible])

  useEffect(() => {
    const header = headerRef.current
    if (!header) return
    const root = document.documentElement
    let frame = 0
    const update = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const hidden = appMode === 'agent'
          && !agentMobileHeaderVisible
          && window.matchMedia('(max-width: 639px)').matches
        root.style.setProperty('--app-header-height', `${hidden ? 0 : Math.ceil(header.getBoundingClientRect().height)}px`)
      })
    }
    const observer = new ResizeObserver(update)
    observer.observe(header)
    window.addEventListener('resize', update)
    update()
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', update)
      root.style.removeProperty('--app-header-height')
    }
  }, [appMode, agentMobileHeaderVisible])

  const installTooltip = useTooltip()
  const helpTooltip = useTooltip()
  const settingsTooltip = useTooltip()

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
      setIsPwaInstalled(false)
    }

    const handleAppInstalled = () => {
      setInstallPrompt(null)
      setIsPwaInstalled(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const handleInstallClick = async () => {
    if (installPrompt) {
      const promptEvent = installPrompt
      setInstallPrompt(null)

      try {
        await promptEvent.prompt()
        const choice = await promptEvent.userChoice
        setIsPwaInstalled(choice.outcome === 'accepted')
      } catch {
        setIsPwaInstalled(isInstalledPwa())
      }
    } else {
      const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
      if (isIos) {
        setConfirmDialog({
          title: '安装为应用',
          message: '在 Safari 浏览器中，点击底部「分享」按钮，选择「添加到主屏幕」即可安装此应用。',
          surface: 'metal3d',
          showCancel: false,
          confirmText: '我知道了',
          icon: 'info',
          action: () => {},
        })
      } else {
        setConfirmDialog({
          title: '安装为应用',
          message: '请在浏览器的菜单中选择「添加到主屏幕」或「安装应用」。\n\n（如果在微信等内置浏览器中，请先在外部浏览器打开）',
          surface: 'metal3d',
          showCancel: false,
          confirmText: '我知道了',
          icon: 'info',
          action: () => {},
        })
      }
    }
  }

  const hideForSearch = appMode === 'gallery' && gallerySearchFocused

  return (
    <>
      <header ref={headerRef} data-app-header data-no-drag-select className={`safe-area-top fixed top-0 left-0 right-0 z-40 border-b border-border bg-sidebar/90 backdrop-blur transition-transform duration-300 ease-in-out dark:border-white/[0.08] dark:bg-gray-950/80 ${appMode === 'agent' && !agentMobileHeaderVisible ? '-translate-y-full sm:translate-y-0' : 'translate-y-0'}`}>
        <div className="safe-area-x safe-header-inner max-w-7xl mx-auto flex items-center justify-between relative">
          <div className={`flex min-w-0 items-center gap-1 overflow-hidden pr-1 transition-all duration-300 ease-out sm:gap-2 sm:pr-2 ${hideForSearch
            ? 'xl:w-0 xl:flex-none xl:pr-0 xl:opacity-0 xl:pointer-events-none'
            : 'flex-1 xl:w-[140px] xl:flex-none xl:opacity-100'
          }`}>
            <h1 className="relative inline-flex min-w-0 items-start whitespace-nowrap sm:mr-2">
              {showFavoriteCollectionTitle ? (
                <>
                  <span className="min-w-0 truncate text-[17px] font-bold tracking-tight text-gray-800 dark:text-gray-100 sm:hidden" title={favoriteCollectionTitle}>{favoriteCollectionTitle}</span>
                  <a
                    href="/"
                    className="hidden text-lg font-bold tracking-tight text-gray-800 transition-colors hover:text-gray-600 dark:text-gray-100 dark:hover:text-gray-300 sm:inline"
                  >
                    JWS Image
                  </a>
                </>
              ) : (
                <a
                  href="/"
                  className="whitespace-nowrap text-[17px] font-bold tracking-tight text-gray-800 transition-colors hover:text-gray-600 dark:text-gray-100 dark:hover:text-gray-300 sm:text-lg"
                >
                  JWS Image
                </a>
              )}
            </h1>
            <button
              type="button"
              aria-label="打开拓展工作区"
              title="拓展工作区"
              onClick={() => navigateToExtensionWorkspace()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-sidebar text-gray-500 transition-colors hover:bg-muted hover:text-gray-900 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-white/[0.07] dark:hover:text-gray-100 lg:hidden"
            >
              <CodeIcon className="h-[18px] w-[18px]" />
            </button>
          </div>
          {appMode === 'gallery' && (
            <GalleryHeaderControls focused={gallerySearchFocused} onFocusChange={setGallerySearchFocused} />
          )}
          {showFavoriteCollectionTitle && (
            <div className="absolute left-1/2 top-1/2 hidden max-w-[30%] -translate-x-1/2 -translate-y-1/2 sm:flex xl:hidden">
              <div className="truncate rounded px-2 py-1 text-sm font-semibold text-gray-700 dark:text-gray-300" title={favoriteCollectionTitle}>
                {favoriteCollectionTitle}
              </div>
            </div>
          )}
          <AiLiquidModeSwitch
            value="gallery"
            onChange={(mode) => {
              if (mode === 'canvas') navigateToCanvas()
            }}
            className={`grid w-[116px] shrink-0 transition-all duration-300 ease-out [&_button]:px-2 sm:w-[168px] sm:[&_button]:px-4 ${hideForSearch
              ? 'xl:mr-0 xl:w-0 xl:opacity-0 xl:pointer-events-none'
              : 'mx-1 opacity-100 sm:ml-0 sm:mr-4'
            }`}
          />
          <div className={`flex shrink-0 items-center gap-1 overflow-hidden transition-all duration-300 ease-out ${hideForSearch
            ? 'xl:max-w-0 xl:opacity-0 xl:pointer-events-none'
            : 'max-w-[160px] opacity-100'
          }`}>
            {!isPwaInstalled && (
              <div
                className="relative hidden sm:block"
                {...installTooltip.handlers}
              >
                <button
                  type="button"
                  onClick={() => {
                    dismissAllTooltips()
                    handleInstallClick()
                  }}
                  aria-label="安装为应用"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200 [&_svg]:h-[18px] [&_svg]:w-[18px]"
                >
                  <InstallIcon />
                </button>
                <ViewportTooltip visible={installTooltip.visible} className="whitespace-nowrap">
                  安装为应用
                </ViewportTooltip>
              </div>
            )}
            <div
              className="relative hidden sm:block"
              {...helpTooltip.handlers}
            >
              <button
                type="button"
                onClick={() => {
                  dismissAllTooltips()
                  setShowHelp(true)
                }}
                aria-label="操作指南"
                className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200 [&_svg]:h-[18px] [&_svg]:w-[18px]"
              >
                <HelpCircleIcon />
              </button>
              <ViewportTooltip visible={helpTooltip.visible} className="whitespace-nowrap">
                操作指南
              </ViewportTooltip>
            </div>
            <div
              className="relative"
              {...settingsTooltip.handlers}
            >
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                aria-label="设置"
                className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.06] dark:hover:text-gray-200 [&_svg]:h-[18px] [&_svg]:w-[18px]"
              >
                <SettingsIcon />
              </button>
              <ViewportTooltip visible={settingsTooltip.visible} className="whitespace-nowrap">
                设置
              </ViewportTooltip>
            </div>
          </div>
        </div>
      </header>
      
      {/* Hint for sliding down */}
      <div className={`fixed top-0 left-0 right-0 z-30 flex justify-center pointer-events-none transition-all duration-300 ease-in-out sm:hidden ${appMode === 'agent' && hintVisible && !agentMobileHeaderVisible ? 'translate-y-[env(safe-area-inset-top,0px)] opacity-100' : '-translate-y-full opacity-0'}`}>
        <div className="bg-black/60 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-b-xl shadow-lg">
          下拉展示顶栏
        </div>
      </div>

      <div className={`safe-area-top invisible pointer-events-none transition-all duration-300 ease-in-out ${appMode === 'agent' && !agentMobileHeaderVisible ? 'max-h-0 sm:max-h-[500px] opacity-0 sm:opacity-100 overflow-hidden sm:overflow-visible' : 'max-h-[500px] opacity-100'}`} aria-hidden="true">
        <div className="safe-header-inner" />
      </div>
      {showHelp && <HelpModal appMode={appMode} isFavoriteCollectionOverview={appMode === 'gallery' && filterFavorite && !activeFavoriteCollectionId} onClose={() => setShowHelp(false)} />}
    </>
  )
}
