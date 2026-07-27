import { useEffect, useLayoutEffect, useState } from 'react'
import { initStore } from './store'
import { useStore } from './store'
import { activateFirstImportedProfile, buildSettingsFromUrlParams, clearUrlSettingParams, hasUrlSettingParams } from './lib/urlSettings'
import { isDefaultConfigOnlyEnabled, mergeImportedSettings } from './lib/apiProfiles'
import { getCustomProviderConfigUrl, loadCustomProviderSettingsFromUrl } from './lib/customProviderConfigUrl'
import { getSub2Token, OPEN_SUB2_CONNECT_EVENT } from './lib/sub2api'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import type { AppSettings } from './types'
import Header from './components/Header'
import SearchBar from './features/gallery/components/SearchBar'
import TaskGrid from './features/gallery/components/TaskGrid'
import AgentWorkspace from './features/agent/components/AgentWorkspace'
import Sub2ImageConversationComposer from './integrations/conversation/Sub2ImageConversationComposer'
import DetailModal from './features/gallery/components/DetailModal'
import Lightbox from './features/gallery/components/Lightbox'
import SettingsModal from './features/settings/components/SettingsModal'
import ConfirmDialog from './components/ui/ConfirmDialog'
import Toast from './components/ui/Toast'
import MaskEditorModal from './features/imageEditor/components/MaskEditorModal'
import ImageContextMenu from './features/gallery/components/ImageContextMenu'
import SupportPromptModal from './components/SupportPromptModal'
import LandingPage from './components/LandingPage'
import JwsConnectModal from './components/JwsConnectModal'
import { FavoriteCollectionPickerModal, FavoriteCollectionsView, ManageCollectionsModal } from './components/FavoriteCollections'
import { ExtensionWorkspace, isExtensionPath } from './ExtensionWorkspace'
import { CanvasApp, CanvasPickerModal, isCanvasPath } from './features/canvas'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import {
  autoSaveSkillToCloud,
  initCloudRuntime,
  removeSkillFromCloud,
  saveSkillWithCloudState,
  useCloudRuntimeState,
} from './features/cloud'

let customProviderConfigUrlImportStarted = false

export default function App() {
  const [path, setPath] = useState(window.location.pathname)
  const theme = useStore((s) => s.settings.theme)
  const cloud = useCloudRuntimeState()

  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && media.matches)
      document.documentElement.classList.toggle('dark', dark)
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#09090b' : '#eef1f4')
    }

    apply()
    if (theme !== 'system') return

    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (!isExtensionPath(path) && !isCanvasPath(path)) return
    void initCloudRuntime().catch((err) => console.warn('加载云端数据失败：', err))
  }, [path])

  if (isCanvasPath(path)) {
    return <CanvasApp path={path} />
  }

  if (isExtensionPath(path)) {
    return (
      <>
        <ExtensionWorkspace
          skillCloud={{
            skills: Object.fromEntries(Object.entries(cloud.skills).map(([id, item]) => [id, item.status])),
            onImported: (id) => {
              void autoSaveSkillToCloud(id)
            },
            onSave: async (id) => {
              if (!getSub2Token()) {
                window.location.assign('/app?connect=jws')
                return
              }
              await saveSkillWithCloudState(id)
            },
            onRemove: removeSkillFromCloud,
          }}
        />
        <Toast />
      </>
    )
  }

  if (path !== '/app' && path !== '/app/') {
    return (
      <LandingPage
        onEnter={() => {
          window.history.pushState(null, '', getSub2Token() ? '/app' : '/app?connect=jws')
          setPath('/app')
        }}
      />
    )
  }

  return <Workspace />
}

function Workspace() {
  const setSettings = useStore((s) => s.setSettings)
  const appMode = useStore((s) => s.appMode)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const [showJwsConnect, setShowJwsConnect] = useState(() => new URLSearchParams(window.location.search).get('connect') === 'jws')
  useDockerApiUrlMigrationNotice()
  useGlobalClickSuppression()

  useEffect(() => {
    const open = () => {
      setShowJwsConnect(true)
      const params = new URLSearchParams(window.location.search)
      params.set('connect', 'jws')
      window.history.replaceState(null, '', `${window.location.pathname}?${params}${window.location.hash}`)
    }
    window.addEventListener(OPEN_SUB2_CONNECT_EVENT, open)
    return () => window.removeEventListener(OPEN_SUB2_CONNECT_EVENT, open)
  }, [])

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const customProviderConfigUrl = getCustomProviderConfigUrl()
    const defaultConfigOnly = isDefaultConfigOnlyEnabled()

    const applyUrlSettings = (baseSettings: Partial<AppSettings>) => {
      const nextSettings = buildSettingsFromUrlParams(baseSettings, searchParams)
      return Object.keys(nextSettings).length ? nextSettings : baseSettings
    }

    const clearAppliedUrlSettings = () => {
      if (!hasUrlSettingParams(searchParams)) return

      clearUrlSettingParams(searchParams)

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    if (customProviderConfigUrl && defaultConfigOnly && !customProviderConfigUrlImportStarted) {
      customProviderConfigUrlImportStarted = true
      void loadCustomProviderSettingsFromUrl(customProviderConfigUrl)
        .then((importedSettings) => {
          const state = useStore.getState()
          const baseSettings = importedSettings
            ? activateFirstImportedProfile(mergeImportedSettings(state.settings, importedSettings), importedSettings)
            : state.settings
          state.setSettings(applyUrlSettings(baseSettings))
          clearAppliedUrlSettings()
        })
        .catch((error) => {
          console.warn('Failed to import custom provider config URL:', error)
          const state = useStore.getState()
          state.setSettings(applyUrlSettings(state.settings))
          clearAppliedUrlSettings()
        })

      void initStore()
        .then(() => initCloudRuntime())
        .catch((err) => console.error('初始化应用失败：', err))
      return
    }

    const nextSettings = buildSettingsFromUrlParams(useStore.getState().settings, searchParams)

    setSettings(nextSettings)

    clearAppliedUrlSettings()

    if (customProviderConfigUrl && !customProviderConfigUrlImportStarted) {
      customProviderConfigUrlImportStarted = true
      void loadCustomProviderSettingsFromUrl(customProviderConfigUrl)
        .then((importedSettings) => {
          if (!importedSettings) return
          const state = useStore.getState()
          state.setSettings(mergeImportedSettings(state.settings, importedSettings))
        })
        .catch((error) => {
          console.warn('Failed to import custom provider config URL:', error)
        })
    }

    void initStore()
      .then(() => initCloudRuntime())
      .catch((err) => console.error('初始化应用失败：', err))
  }, [setSettings])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  return (
    <>
      <Header />
      {appMode === 'agent' ? (
        <AgentWorkspace />
      ) : (
        <main data-home-main data-drag-select-surface style={{ paddingBottom: 'calc(var(--composer-stack-clearance, 10rem) + 2rem)' }}>
          <div className="safe-area-x max-w-7xl mx-auto">
            <SearchBar />
            {filterFavorite && !activeFavoriteCollectionId ? <FavoriteCollectionsView /> : <TaskGrid />}
          </div>
        </main>
      )}
      <Sub2ImageConversationComposer />
      <DetailModal />
      <Lightbox />
      {showJwsConnect && (
        <JwsConnectModal
          onClose={() => {
            setShowJwsConnect(false)
            const params = new URLSearchParams(window.location.search)
            params.delete('connect')
            const search = params.toString()
            window.history.replaceState(null, '', `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`)
          }}
        />
      )}
      <SettingsModal />
      <ConfirmDialog />
      <SupportPromptModal />
      <FavoriteCollectionPickerModal />
      <ManageCollectionsModal />
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
      <CanvasPickerModal />
    </>
  )
}
