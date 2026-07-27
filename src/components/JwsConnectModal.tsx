import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import {
  getSub2PublicSettings,
  listSub2Groups,
  loginSub2,
  loginSub2TwoFactor,
  type Sub2PublicSettings,
} from '../lib/sub2api'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { usePreventBackgroundScroll } from '../hooks/usePreventBackgroundScroll'
import { CloseIcon } from './ui/icons'

interface JwsConnectModalProps {
  onClose: () => void
}

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
      remove: (id: string) => void
      reset: (id: string) => void
    }
  }
}

export default function JwsConnectModal({ onClose }: JwsConnectModalProps) {
  const showToast = useStore((s) => s.showToast)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const scrollRef = useRef<HTMLDivElement>(null)
  const turnstileRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef('')
  const [step, setStep] = useState<'login' | '2fa'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [tempToken, setTempToken] = useState('')
  const [publicSettings, setPublicSettings] = useState<Sub2PublicSettings | null>(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useCloseOnEscape(true, onClose)
  usePreventBackgroundScroll(true, scrollRef)

  useEffect(() => {
    void getSub2PublicSettings()
      .then(setPublicSettings)
      .catch((err) => {
        console.error('[JWS] 获取 Sub2API 公共设置失败', err)
        setError(err instanceof Error ? err.message : '无法连接 Sub2API')
      })
  }, [])

  useEffect(() => {
    if (!publicSettings?.turnstile_enabled || !publicSettings.turnstile_site_key || !turnstileRef.current) return

    const render = () => {
      if (!window.turnstile || !turnstileRef.current || widgetIdRef.current) return
      widgetIdRef.current = window.turnstile.render(turnstileRef.current, {
        sitekey: publicSettings.turnstile_site_key,
        callback: (token: string) => {
          setTurnstileToken(token)
          setError('')
        },
        'error-callback': () => setError('安全验证加载失败，请确认当前域名已加入 Turnstile 白名单。'),
      })
    }

    const existing = document.getElementById('jws-turnstile-script') as HTMLScriptElement | null
    if (existing) {
      if (window.turnstile) render()
      else existing.addEventListener('load', render, { once: true })
    } else {
      const script = document.createElement('script')
      script.id = 'jws-turnstile-script'
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.addEventListener('load', render, { once: true })
      script.addEventListener('error', () => setError('安全验证脚本加载失败。'), { once: true })
      document.head.appendChild(script)
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) window.turnstile.remove(widgetIdRef.current)
      widgetIdRef.current = ''
    }
  }, [publicSettings])

  const finishLogin = async () => {
    const groups = await listSub2Groups()
    setPassword('')
    showToast(`已登录 Sub2API，读取到 ${groups.length} 个分组`, 'success')
    onClose()
    setShowSettings(true, 'agent')
  }

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!email.trim() || !password) return

    setBusy(true)
    setError('')
    try {
      const nextPublicSettings = publicSettings ?? await getSub2PublicSettings()
      setPublicSettings(nextPublicSettings)
      if (nextPublicSettings.turnstile_enabled && !nextPublicSettings.turnstile_site_key) {
        throw new Error('项目未配置 Turnstile Site Key')
      }
      if (nextPublicSettings.turnstile_enabled && !turnstileToken) {
        setError('请先完成人机验证。')
        return
      }

      const data = await loginSub2(email.trim(), password, turnstileToken)
      if (data.requires2fa) {
        setTempToken(data.tempToken)
        setStep('2fa')
        return
      }
      await finishLogin()
    } catch (err) {
      console.error('[JWS] 登录接入失败', err)
      setError(err instanceof Error ? err.message : '登录失败')
      if (widgetIdRef.current && window.turnstile) window.turnstile.reset(widgetIdRef.current)
      setTurnstileToken('')
    } finally {
      setBusy(false)
    }
  }

  const handle2fa = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!code.trim()) return

    setBusy(true)
    setError('')
    try {
      await loginSub2TwoFactor(tempToken, code.trim(), email.trim())
      await finishLogin()
    } catch (err) {
      console.error('[JWS] 两步验证失败', err)
      setError(err instanceof Error ? err.message : '验证失败')
    } finally {
      setBusy(false)
    }
  }

  const inputClass = 'mt-2 h-12 w-full rounded-[4px] border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none transition-colors focus:border-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:focus:border-white'

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm animate-overlay-in sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="grid max-h-[92svh] w-full max-w-4xl overflow-hidden rounded-lg border border-black bg-white shadow-2xl animate-modal-in dark:border-white/20 dark:bg-zinc-950 md:grid-cols-[0.8fr_1.2fr]">
        <aside className="flex min-h-0 flex-col items-center justify-center overflow-hidden border-b border-black bg-white p-4 dark:border-white/20 dark:bg-zinc-950 md:border-b-0 md:border-r md:p-7">
          <img src="/jws-brand.jpg" alt="My Jarvis" className="h-auto max-h-48 w-full object-contain dark:invert md:max-h-none" />
          <div className="hidden w-full border-t border-black pt-5 dark:border-white/20 md:block">
            <p className="text-xs font-bold uppercase">JWS Connect / 我的贾维斯</p>
            <p className="mt-3 text-sm leading-6 opacity-55">登录后读取账号中的可用分组。</p>
          </div>
        </aside>

        <section ref={scrollRef} className="min-h-0 overflow-y-auto p-5 text-black dark:text-white sm:p-8">
          <div className="flex items-start justify-between gap-4 border-b border-black pb-5 dark:border-white/20">
            <div>
              <p className="text-[11px] font-bold uppercase opacity-40">Connection setup</p>
              <h2 className="mt-1 text-2xl font-black tracking-normal">登录 Sub2API</h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-[4px] p-2 text-gray-500 hover:bg-gray-100 hover:text-black dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-white" aria-label="关闭" title="关闭">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>

          {step === 'login' && (
            <form className="mt-6 space-y-5" onSubmit={handleLogin}>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block text-sm font-medium">
                  邮箱
                  <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} autoComplete="email" required />
                </label>
                <label className="block text-sm font-medium">
                  密码
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} autoComplete="current-password" required />
                </label>
              </div>
              {publicSettings?.turnstile_enabled && <div ref={turnstileRef} className="min-h-[65px]" />}
              {error && <p className="border-l-2 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
              <button type="submit" disabled={busy} className="inline-flex min-h-12 w-full items-center justify-center gap-4 rounded-[4px] bg-black px-5 text-sm font-bold text-white transition-colors hover:bg-gray-800 disabled:cursor-wait disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-gray-200">
                {busy ? '正在连接...' : '登录我的贾维斯'} <span aria-hidden="true">→</span>
              </button>
              <p className="text-xs leading-5 opacity-40">账号密码仅用于本次登录，不会保存在 JWS Image。</p>
            </form>
          )}

          {step === '2fa' && (
            <form className="mt-6 space-y-5" onSubmit={handle2fa}>
              <div>
                <p className="text-sm font-bold">两步验证</p>
                <p className="mt-1 text-sm opacity-50">输入身份验证器中的 6 位验证码。</p>
              </div>
              <label className="block text-sm font-medium">
                验证码
                <input type="text" inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} className={inputClass} autoComplete="one-time-code" maxLength={8} required />
              </label>
              {error && <p className="border-l-2 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
              <button type="submit" disabled={busy} className="inline-flex min-h-12 w-full items-center justify-center gap-4 rounded-[4px] bg-black px-5 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-60 dark:bg-white dark:text-black">
                {busy ? '正在验证...' : '完成验证'} <span aria-hidden="true">→</span>
              </button>
            </form>
          )}

        </section>
      </div>
    </div>
  )
}
