import { expect, test, type Page } from '@playwright/test'

async function openApp(page: Page) {
  await page.route('https://fontsapi.zeoseven.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  await page.route('https://cdn.jsdelivr.net/npm/@lobehub/webfont-harmony-sans-sc@1.0.0/**', (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }))
  await page.goto('/app')
  await expect(page.locator('[data-app-header]')).toBeVisible()
}

test('拓展工作区支持导航、浏览器后退和返回原应用', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))

  await openApp(page)
  await page.getByRole('button', { name: '打开拓展工作区', exact: true }).click()

  await expect(page).toHaveURL(/\/app\/extensions$/)
  await expect(page.locator('[data-extension-workspace]')).toBeVisible()
  await expect(page.getByRole('heading', { name: '工具', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '技能', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/extensions\/skills$/)
  await expect(page.getByRole('heading', { name: '技能', exact: true })).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(/\/app\/extensions$/)
  await expect(page.getByRole('heading', { name: '工具', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '返回原应用', exact: true }).click()
  await expect(page).toHaveURL(/\/app$/)
  await expect(page.locator('[data-app-header]')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  expect(errors).toEqual([])
})

test('Skills 平铺展示开源来源和详情', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: '打开拓展工作区', exact: true }).click()
  await page.getByRole('button', { name: '技能', exact: true }).click()

  await expect(page.getByRole('button', { name: '查看 电商产品图', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看 角色一致性', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看 图片编辑', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看 海报与排版', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看 分镜创作', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看 视频生成提示词', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '查看 电商产品图', exact: true }).click()
  await expect(page).toHaveURL(/\/app\/extensions\/skills\/product-photography$/)
  await expect(page.getByRole('link', { name: '查看开源项目', exact: true })).toHaveAttribute('href', 'https://github.com/anthropics/skills')
  await expect(page.getByText(/把用户的商品需求转成清晰/)).toBeVisible()
})

// 对话功能暂时隐藏（顶部切换已指向无限画布），入口恢复后再启用本用例
test.skip('Agent 对话只通过结构化 @ mention 手动选择一个 Skill', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: '对话', exact: true }).click()

  const input = page.getByRole('textbox', { name: 'Agent 对话输入', exact: true })
  await input.pressSequentially('@')
  await expect(page.getByRole('button', { name: '选择 @电商产品图', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '选择 @视频生成提示词', exact: true })).toBeVisible()

  await page.getByRole('button', { name: '选择 @电商产品图', exact: true }).click()
  const atom = input.locator('[data-composer-value]')
  await expect(atom).toHaveText('@电商产品图')
  await expect(atom).toHaveAttribute('data-composer-value', /skill:product-photography/)

  await input.pressSequentially(' 制作一张商品主图 @')
  await expect(page.getByRole('button', { name: '选择 @角色一致性', exact: true })).toHaveCount(0)
})

test('画廊输入框弹出 Skill 并随输入持续收紧筛选', async ({ page }) => {
  await openApp(page)

  const input = page.getByRole('textbox', { name: '图片提示词输入', exact: true })
  await input.pressSequentially('@')
  const picker = page.locator('[data-skill-picker]')
  await expect(picker).toBeVisible()
  const pickerBox = await picker.boundingBox()
  const composerBox = await page.locator('[data-conversation-composer]').boundingBox()
  expect(pickerBox).not.toBeNull()
  expect(composerBox).not.toBeNull()
  expect(pickerBox!.y + pickerBox!.height).toBeLessThanOrEqual(composerBox!.y)
  await expect(page.getByRole('button', { name: '选择 @电商产品图', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '选择 @视频生成提示词', exact: true })).toBeVisible()

  await input.pressSequentially('连续')
  await expect(page.getByRole('button', { name: '选择 @角色一致性', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '选择 @分镜创作', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '选择 @电商产品图', exact: true })).toHaveCount(0)

  await input.pressSequentially('角色')
  await expect(page.getByRole('button', { name: '选择 @角色一致性', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '选择 @分镜创作', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: '选择 @角色一致性', exact: true }).click()
  await expect(input.locator('[data-composer-value]')).toHaveText('@角色一致性')
})

test('Tools 展示图片编辑器入口并打开图片来源页', async ({ page }, testInfo) => {
  await openApp(page)
  await page.getByRole('button', { name: '打开拓展工作区', exact: true }).click()

  const editor = page.getByRole('button', { name: '打开图片编辑器', exact: true })
  await expect(editor).toBeVisible()
  await expect(editor.locator('img').first()).toHaveAttribute('src', '/tools/image-editor/cover.webp')
  await expect(editor.locator('img').nth(1)).toHaveAttribute('src', '/tools/image-editor/icon.png')
  const backgroundRemover = page.locator('[data-tool-id="background-remover"]')
  await expect(backgroundRemover).toBeVisible()
  await expect(backgroundRemover.locator('img').first()).toHaveAttribute('src', '/tools/background-remover/cover.webp')
  await expect(backgroundRemover.locator('img').nth(1)).toHaveAttribute('src', '/tools/background-remover/icon.png')
  await expect(page.getByRole('button', { name: '打开一键抠图', exact: true })).toBeVisible()
  if (testInfo.project.name === 'desktop') {
    await editor.hover()
    expect(await editor.locator('img').nth(1).evaluate((icon) => {
      const rect = icon.getBoundingClientRect()
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === icon
    })).toBe(true)
  }

  await editor.click()
  await expect(page).toHaveURL(/\/app\/extensions\/tools\/image-editor$/)
  await expect(page.getByRole('heading', { name: '图片编辑器', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回上一页', exact: true })).toBeVisible()
  await expect(page.locator('[data-image-source-picker]')).toBeVisible()
  await expect(page.getByRole('button', { name: '上传图片', exact: true })).toBeVisible()
})

test('一键抠图可以打开图片来源页并准备处理本地图片', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: '打开拓展工作区', exact: true }).click()
  await page.getByRole('button', { name: '打开一键抠图', exact: true }).click()

  await expect(page).toHaveURL(/\/app\/extensions\/tools\/background-remover$/)
  await expect(page.getByRole('heading', { name: '一键抠图', exact: true })).toBeVisible()
  await expect(page.getByText('选择一张图片开始抠图', { exact: true })).toBeVisible()

  await page.locator('[data-image-source-picker] input[type="file"]').setInputFiles({
    name: 'background-source.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'),
  })

  await expect(page.locator('[data-background-remover-tool]')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: '开始抠图', exact: true })).toBeVisible()
})

test('图片编辑器可以加载本地图片并挂载 Filerobot Canvas', async ({ page }, testInfo) => {
  await openApp(page)
  await page.getByRole('button', { name: '打开拓展工作区', exact: true }).click()
  await page.getByRole('button', { name: '打开图片编辑器', exact: true }).click()

  await page.locator('[data-image-source-picker] input[type="file"]').setInputFiles({
    name: 'sample.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'),
  })

  await expect(page.locator('[data-image-editor-tool]')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => page.locator('[data-image-editor-tool] canvas').count()).toBeGreaterThan(0)
  await expect(page.getByText('保存', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('调整', { exact: true }).first()).toHaveText('调整')
  await expect(page.getByText('裁剪', { exact: true }).first()).toHaveText('裁剪')
  expect(await page.getByText(/^(Save|Adjust|Crop|Annotate|Filters|Finetune|Resize|Watermark)$/).count()).toBe(0)

  if (testInfo.project.name === 'desktop') {
    await page.getByText('滤镜', { exact: true }).first().click()
    await expect.poll(() => page.locator('.FIE_filters-item-label').count()).toBeGreaterThan(0)
    const labels = await page.locator('.FIE_filters-item-label').allTextContents()
    expect(labels.some((label) => /[A-Za-z]/.test(label))).toBe(false)
  }
})

test('图片编辑器保存结果到画廊和 IndexedDB', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: '打开拓展工作区', exact: true }).click()
  await page.getByRole('button', { name: '打开图片编辑器', exact: true }).click()

  await page.locator('[data-image-source-picker] input[type="file"]').setInputFiles({
    name: 'persistent.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64'),
  })

  await expect(page.locator('[data-image-editor-tool]')).toBeVisible({ timeout: 15_000 })
  await expect.poll(() => page.locator('[data-image-editor-tool] canvas').count()).toBeGreaterThan(0)
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.getByText('保存', { exact: true }).first().click()
  await expect(page.locator('.FIE_save-modal')).toBeVisible()

  const input = page.locator('.FIE_save-modal .SfxInput-root').first()
  await expect(input).toBeVisible()
  expect(await input.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(39, 39, 42)')
  expect(await input.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(244, 244, 245)')

  await page.getByTestId('FIE-modal-confirm-button').click()
  await expect(page.getByText('编辑结果已保存到画廊', { exact: true })).toBeVisible()

  const saved = await page.evaluate(() => new Promise<{ taskId: string; imageId: string }>((resolve, reject) => {
    const req = indexedDB.open('gpt-image-playground')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(['tasks', 'images'], 'readonly')
      const tasksReq = tx.objectStore('tasks').getAll()
      tasksReq.onerror = () => reject(tasksReq.error)
      tasksReq.onsuccess = () => {
        const task = (tasksReq.result as Array<{ id: string; prompt: string; outputImages: string[] }>)
          .find((item) => item.prompt.startsWith('图片编辑器：'))
        if (!task) {
          reject(new Error('未找到图片编辑器画廊任务'))
          return
        }
        const imageReq = tx.objectStore('images').get(task.outputImages[0])
        imageReq.onerror = () => reject(imageReq.error)
        imageReq.onsuccess = () => {
          if (!imageReq.result) {
            reject(new Error('未找到编辑结果图片'))
            return
          }
          resolve({ taskId: task.id, imageId: task.outputImages[0] })
        }
      }
    }
  }))

  await page.getByRole('button', { name: '返回上一页', exact: true }).click()
  await page.getByRole('button', { name: '返回原应用', exact: true }).click()
  await expect(page.locator(`[data-task-id="${saved.taskId}"]`)).toBeVisible()
  await page.reload()
  await expect(page.locator(`[data-task-id="${saved.taskId}"]`)).toBeVisible()
})
