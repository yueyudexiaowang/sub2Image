import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getSub2PublicSettings,
  listSub2Keys,
  listSub2Models,
  loginSub2,
  loginSub2TwoFactor,
  refreshSub2Token,
} from './sub2api'

const values = new Map<string, string>()

beforeEach(() => {
  values.clear()
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function ok(data: unknown) {
  return new Response(JSON.stringify({ code: 0, data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Sub2API 登录', () => {
  it('从同源代理读取公共设置', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({ turnstile_enabled: true, turnstile_site_key: 'site-key' }))
    vi.stubGlobal('fetch', fetcher)

    await expect(getSub2PublicSettings()).resolves.toEqual({ turnstile_enabled: true, turnstile_site_key: 'site-key' })
    expect(fetcher).toHaveBeenCalledWith('/sub2api-auth/settings/public', expect.any(Object))
  })

  it('携带 Turnstile token 并保存登录状态', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      user: { email: 'hello@example.com' },
    }))
    vi.stubGlobal('fetch', fetcher)

    await expect(loginSub2('hello@example.com', 'secret', 'turnstile-token')).resolves.toEqual({
      requires2fa: false,
      user: { email: 'hello@example.com' },
    })
    expect(fetcher).toHaveBeenCalledWith('/sub2api-auth/auth/login', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        email: 'hello@example.com',
        password: 'secret',
        turnstile_token: 'turnstile-token',
      }),
    }))
    expect(values.get('image2.sub2api.token')).toBe('access-token')
    expect(values.get('image2.sub2api.refresh')).toBe('refresh-token')
  })

  it('完成两步验证后保存登录状态', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ok({ requires_2fa: true, temp_token: 'temp-token', user_email_masked: 'h***@example.com' }))
      .mockResolvedValueOnce(ok({ access_token: 'access-token', user: { email: 'hello@example.com' } }))
    vi.stubGlobal('fetch', fetcher)

    await expect(loginSub2('hello@example.com', 'secret')).resolves.toEqual({
      requires2fa: true,
      tempToken: 'temp-token',
      maskedEmail: 'h***@example.com',
    })
    await expect(loginSub2TwoFactor('temp-token', '123456', 'hello@example.com')).resolves.toEqual({ email: 'hello@example.com' })
    expect(fetcher).toHaveBeenLastCalledWith('/sub2api-auth/auth/login/2fa', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ temp_token: 'temp-token', totp_code: '123456' }),
    }))
    expect(values.get('image2.sub2api.token')).toBe('access-token')
  })

  it('账号切换后不写入旧账号的刷新结果', async () => {
    values.set('image2.sub2api.token', 'access-a')
    values.set('image2.sub2api.refresh', 'refresh-a')
    let resolve: (value: Response) => void = () => undefined
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((done) => {
      resolve = done
    })))

    const refreshing = refreshSub2Token()
    values.set('image2.sub2api.token', 'access-b')
    values.set('image2.sub2api.refresh', 'refresh-b')
    resolve(ok({ access_token: 'stale-access-a', refresh_token: 'stale-refresh-a' }))

    await expect(refreshing).rejects.toThrow('登录状态已变化')
    expect(values.get('image2.sub2api.token')).toBe('access-b')
    expect(values.get('image2.sub2api.refresh')).toBe('refresh-b')
  })
})

describe('Sub2API 模型', () => {
  it('使用当前账号分页读取完整 Key 列表并穿透线上缓存', async () => {
    values.set('image2.sub2api.token', 'account-token')
    const fetcher = vi.fn()
      .mockResolvedValueOnce(ok({
        items: [{ id: 1, key: 'sk-user-1', name: '默认', status: 'active', group_id: 2 }],
        total: 2,
        page: 1,
        page_size: 20,
        pages: 2,
      }))
      .mockResolvedValueOnce(ok({
        items: [{ id: 2, key: 'sk-user-2', name: '视频', status: 'active', group_id: 3 }],
        total: 2,
        page: 2,
        page_size: 20,
        pages: 2,
      }))
    vi.stubGlobal('fetch', fetcher)

    await expect(listSub2Keys()).resolves.toHaveLength(2)
    expect(fetcher.mock.calls[0][0]).toMatch(/^\/sub2api-auth\/keys\?page=1&page_size=20&sort_by=created_at&sort_order=desc&timezone=Asia%2FShanghai&t=\d+$/)
    expect(fetcher.mock.calls[1][0]).toMatch(/^\/sub2api-auth\/keys\?page=2&page_size=20&sort_by=created_at&sort_order=desc&timezone=Asia%2FShanghai&t=\d+$/)
    expect(fetcher.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer account-token')
    expect(fetcher.mock.calls[0][1]).toEqual(expect.objectContaining({ cache: 'no-store' }))
  })

  it('使用用户 Key 读取所属分组的模型并绕过缓存', async () => {
    const fetcher = vi.fn().mockResolvedValue(ok({
      object: 'list',
      data: [
        { id: 'gpt-5.4', object: 'model' },
        { id: 'gpt-image-2', object: 'model' },
      ],
    }))
    vi.stubGlobal('fetch', fetcher)

    await expect(listSub2Models('sk-user')).resolves.toEqual([
      { id: 'gpt-5.4', object: 'model' },
      { id: 'gpt-image-2', object: 'model' },
    ])
    expect(fetcher.mock.calls[0][0]).toMatch(/^\/sub2api-v1\/models\?t=\d+$/)
    expect(fetcher.mock.calls[0][1]).toEqual({
      headers: { Authorization: 'Bearer sk-user' },
      cache: 'no-store',
    })
  })
})
