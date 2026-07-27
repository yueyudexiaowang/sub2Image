import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type Page, type Route } from '@playwright/test'

const API_URL = 'https://e2e.invalid/v1'
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='
const AGENT_TEXT = 'E2E Agent 回复'

function responseJson(text: string) {
  return {
    id: 'resp-e2e',
    output: [{
      id: 'msg-e2e',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text }],
    }],
  }
}

function responseStream() {
  const output = responseJson(AGENT_TEXT).output
  return [
    'data: {"type":"response.created","response":{"id":"resp-e2e","output":[]}}',
    '',
    'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"msg-e2e","type":"message","role":"assistant","status":"in_progress","content":[]}}',
    '',
    'data: {"type":"response.output_text.delta","item_id":"msg-e2e","output_index":0,"delta":"E2E "}',
    '',
    'data: {"type":"response.output_text.delta","item_id":"msg-e2e","output_index":0,"delta":"Agent "}',
    '',
    'data: {"type":"response.output_text.delta","item_id":"msg-e2e","output_index":0,"delta":"回复"}',
    '',
    `data: ${JSON.stringify({ type: 'response.output_item.done', output_index: 0, item: output[0] })}`,
    '',
    `data: ${JSON.stringify({ type: 'response.completed', response: responseJson(AGENT_TEXT) })}`,
    '',
    'data: [DONE]',
    '',
  ].join('\n')
}

async function openConfiguredApp(page: Page, apiMode: 'images' | 'responses') {
  const profile = {
    id: 'e2e-profile',
    name: 'E2E Profile',
    provider: 'openai',
    baseUrl: API_URL,
    apiKey: 'e2e-key',
    model: apiMode === 'images' ? 'gpt-image-e2e' : 'gpt-agent-e2e',
    timeout: 30,
    apiMode,
    codexCli: false,
    apiProxy: false,
    streamImages: apiMode === 'responses',
    streamPartialImages: 0,
  }
  await page.addInitScript((value) => {
    localStorage.setItem('gpt-image-playground', JSON.stringify({
      version: 3,
      state: {
        settings: {
          profiles: [value],
          activeProfileId: value.id,
          agentApiConfigMode: 'off',
          agentTextProfileId: value.id,
          agentImageProfileId: value.id,
        },
      },
    }))
  }, profile)
  await page.route('https://fontsapi.zeoseven.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  await page.route('https://cdn.jsdelivr.net/npm/@lobehub/webfont-harmony-sans-sc@1.0.0/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  await page.goto('/app')
  await expect(page.locator('[contenteditable][aria-label="图片提示词输入"]')).toBeVisible()
}

function trackPageErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  return errors
}

async function expectSingleComposer(page: Page) {
  expect(await page.locator('[data-input-bar]').count()).toBe(0)
  expect(await page.locator('[data-conversation-composer]').count()).toBe(1)
  const box = await page.locator('[data-conversation-composer-dock]').boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
}

async function expectLastContentAboveComposer(page: Page, selector: string) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(async () => {
    const [content, composer] = await Promise.all([
      page.locator(selector).last().boundingBox(),
      page.locator('[data-conversation-composer-dock]').boundingBox(),
    ])
    return Boolean(content && composer && content.y + content.height <= composer.y + 1)
  }).toBe(true)
}

async function saveArtifact(name: string, data: string | Buffer) {
  const dir = resolve('output/playwright/baselines')
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, name), data)
}

test('桌面与移动端只有一个 Composer 且页面模式职责固定', async ({ page }, testInfo) => {
  const errors = trackPageErrors(page)
  await openConfiguredApp(page, 'responses')
  await expectSingleComposer(page)
  expect(await page.locator('.cc-agent-button').count()).toBe(1)
  // 提示词库入口已整合进 composer 工具栏（2026-07 需求）
  expect(await page.locator('[data-conversation-composer-dock] [title="提示词库"]').count()).toBe(1)
  await saveArtifact(`${testInfo.project.name}-gallery.png`, await page.screenshot({ animations: 'disabled', caret: 'hide' }))

  // 对话入口已隐藏，顶部切换指向无限画布
  await page.locator('[data-app-header]').getByRole('button', { name: '无限画布', exact: true }).click()
  await expect(page.getByRole('button', { name: '新建画布' })).toBeVisible()
  await saveArtifact(`${testInfo.project.name}-canvas.png`, await page.screenshot({ animations: 'disabled', caret: 'hide' }))
  expect(errors).toEqual([])
})

test('画廊直发只创建一次图片任务', async ({ page }) => {
  const errors = trackPageErrors(page)
  const requests: Array<Record<string, unknown>> = []
  await page.route(`${API_URL}/**`, async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ created: 1, data: [{ b64_json: PNG_BASE64 }] }) })
  })
  await openConfiguredApp(page, 'images')
  const prompt = '画廊基线：红色纸船'
  await page.locator('[contenteditable][aria-label="图片提示词输入"]').fill(prompt)
  await page.getByRole('button', { name: '生成图片' }).click()

  const task = page.locator('[data-home-main] [data-task-id]')
  await expect(task).toHaveCount(1)
  await expect(task.locator('.saveable-image')).toBeVisible()
  expect(requests).toHaveLength(1)
  expect(requests[0]).toMatchObject({ model: 'gpt-image-e2e', prompt })
  await expectLastContentAboveComposer(page, '[data-task-id]')
  expect(errors).toEqual([])
})

// 对话功能暂时隐藏（顶部切换已指向无限画布），入口恢复后再启用本用例
test.skip('普通 Agent 页面完成聊天闭环', async ({ page }) => {
  const errors = trackPageErrors(page)
  let requests = 0
  await page.route(`${API_URL}/**`, async (route: Route) => {
    const body = route.request().postDataJSON() as { max_output_tokens?: number }
    if (body.max_output_tokens === 32) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(responseJson('<title>E2E 基线</title>')) })
      return
    }
    requests += 1
    await route.fulfill({ status: 200, contentType: 'text/event-stream; charset=utf-8', body: responseStream() })
  })
  await openConfiguredApp(page, 'responses')
  await page.locator('[data-app-header]').getByRole('button', { name: '对话', exact: true }).click()
  const editor = page.locator('[contenteditable][aria-label="Agent 对话输入"]')
  await editor.fill('请只回复基线文本')
  await page.getByRole('button', { name: '发送 Agent 消息' }).click()

  const workspace = page.locator('[data-agent-workspace]')
  await expect(workspace.getByText(AGENT_TEXT, { exact: true })).toBeVisible()
  expect(requests).toBe(1)
  await expectLastContentAboveComposer(page, '[data-agent-workspace] article')
  expect(errors).toEqual([])
})

test('附件支持 40px 缩略图、预览入口、mention 和设置草稿', async ({ page }) => {
  const errors = trackPageErrors(page)
  await openConfiguredApp(page, 'images')
  await page.locator('[data-new-composer-file-input]').setInputFiles({
    name: 'reference.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_BASE64, 'base64'),
  })
  const attachment = page.locator('.cc-attachment').first()
  await expect(attachment).toBeVisible()
  const box = await attachment.boundingBox()
  expect(box?.width).toBe(40)
  expect(box?.height).toBe(40)
  await page.getByRole('button', { name: '预览参考图1' }).click()
  await expect(page.getByRole('button', { name: '编辑遮罩' })).toBeVisible()
  await page.getByRole('button', { name: '关闭预览' }).click()

  const editor = page.locator('[contenteditable][aria-label="图片提示词输入"]')
  await editor.fill('@')
  await page.getByRole('button', { name: '选择 @图1' }).click()
  await expect(editor.locator('.cc-atom')).toHaveText('@图1')

  await page.locator('[data-conversation-composer-dock] [title="图片设置"]').click()
  const settings = page.locator('[data-composer-settings]')
  await expect(settings).toBeVisible()
  await page.getByRole('button', { name: '比例 16:9' }).click()
  await page.getByRole('button', { name: '分辨率 2K' }).click()
  await page.getByRole('button', { name: '生成数量 x2' }).click()
  await page.getByRole('button', { name: '格式 JPEG' }).click()
  await settings.click({ position: { x: 1, y: 1 } })
  await expect(settings).toBeHidden()

  await page.locator('[data-conversation-composer-dock] [title="图片设置"]').click()
  await expect(page.getByRole('button', { name: '比例 16:9' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '分辨率 2K' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '生成数量 x2' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: '格式 JPEG' })).toHaveAttribute('aria-pressed', 'true')
  await settings.click({ position: { x: 1, y: 1 } })
  expect(errors).toEqual([])
})
