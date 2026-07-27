// @vitest-environment jsdom

import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  addImageFromFile: vi.fn(async () => undefined),
  submitAgentMessage: vi.fn(async (_options?: { signal?: AbortSignal; draft?: unknown; conversationId?: string; editingRoundId?: string | null }) => undefined),
  submitAgentDirectImage: vi.fn(async (_options?: { signal?: AbortSignal; draft?: unknown; conversationId?: string }) => undefined),
  submitTask: vi.fn(async (_options?: { signal?: AbortSignal; draft?: unknown }) => undefined),
  stopAgentResponse: vi.fn(),
}))

vi.mock('../../src/store', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/store')>(),
  addImageFromFile: mocks.addImageFromFile,
  submitAgentMessage: mocks.submitAgentMessage,
  submitAgentDirectImage: mocks.submitAgentDirectImage,
  submitTask: mocks.submitTask,
  stopAgentResponse: mocks.stopAgentResponse,
}))

import { ConversationAttachments, ConversationComposer } from '../../src/features/conversationComposer'
import Sub2ImageConversationComposer from '../../src/integrations/conversation/Sub2ImageConversationComposer'
import { clearActiveComposerOwner, NEXT_COMPOSER_OWNER, isComposerFocused } from '../../src/integrations/conversation/composerFocus'
import { getActiveApiProfile } from '../../src/lib/apiProfiles'
import { getSelectedImageMentionLabel } from '../../src/lib/promptImageMentions'
import { useStore } from '../../src/store'

const initialState = useStore.getState()
const elementFromPoint = document.elementFromPoint?.bind(document)
Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: () => new DOMRect(),
})

function ComposerFixture({ enterSubmit = true, onSubmit = vi.fn() }: { enterSubmit?: boolean; onSubmit?: () => void }) {
  const [value, setValue] = useState('')
  return (
    <ConversationComposer
      ownerId="fixture"
      value={value}
      placeholder="输入内容"
      editorAriaLabel="测试编辑器"
      enterSubmit={enterSubmit}
      canSubmit={Boolean(value)}
      onChange={setValue}
      onSubmit={onSubmit}
    />
  )
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  })
  useStore.setState(initialState, true)
  const state = useStore.getState()
  const profile = { ...state.settings.profiles[0]!, id: 'test-profile', apiKey: 'test-key' }
  useStore.setState({
    settings: {
      ...state.settings,
      profiles: [profile],
      activeProfileId: profile.id,
      apiKey: 'test-key',
      reuseTaskApiProfileTemporarily: false,
    },
  })
  clearActiveComposerOwner(NEXT_COMPOSER_OWNER)
  Object.values(mocks).forEach((mock) => mock.mockClear())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: elementFromPoint })
})

describe('ConversationComposer', () => {
  it('does not submit Enter during IME composition', async () => {
    const onSubmit = vi.fn()
    render(<ComposerFixture onSubmit={onSubmit} />)
    const editor = screen.getByRole('textbox', { name: '测试编辑器' })
    await userEvent.click(editor)
    await userEvent.type(editor, '中文')

    fireEvent.compositionStart(editor)
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true })
    fireEvent.compositionEnd(editor)

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps existing Enter and modifier submit behavior', async () => {
    const enterSubmit = vi.fn()
    const user = userEvent.setup()
    const first = render(<ComposerFixture onSubmit={enterSubmit} />)
    const firstEditor = screen.getByRole('textbox', { name: '测试编辑器' })
    await user.click(firstEditor)
    await user.type(firstEditor, '内容')
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(firstEditor.textContent).toContain('\n')
    expect(enterSubmit).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')
    expect(enterSubmit).toHaveBeenCalledOnce()

    first.unmount()
    const modifierSubmit = vi.fn()
    render(<ComposerFixture enterSubmit={false} onSubmit={modifierSubmit} />)
    const secondEditor = screen.getByRole('textbox', { name: '测试编辑器' })
    await user.click(secondEditor)
    await user.type(secondEditor, '内容')
    await user.keyboard('{Enter}')
    expect(modifierSubmit).not.toHaveBeenCalled()
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(modifierSubmit).toHaveBeenCalledOnce()
  })

  it('does not remount or blur the editor when Tool controls change', () => {
    const { rerender } = render(
      <ConversationComposer
        ownerId="fixture"
        value="保持内容"
        placeholder="输入内容"
        editorAriaLabel="测试编辑器"
        enterSubmit
        canSubmit
        toolSlot={<span>Tool A</span>}
        onChange={() => undefined}
        onSubmit={() => undefined}
      />,
    )
    const editor = screen.getByRole('textbox', { name: '测试编辑器' })
    editor.focus()

    rerender(
      <ConversationComposer
        ownerId="fixture"
        value="保持内容"
        placeholder="输入内容"
        editorAriaLabel="测试编辑器"
        enterSubmit
        canSubmit
        toolSlot={<span>Tool B</span>}
        onChange={() => undefined}
        onSubmit={() => undefined}
      />,
    )

    expect(screen.getByRole('textbox', { name: '测试编辑器' })).toBe(editor)
    expect(document.activeElement).toBe(editor)
    expect(editor.textContent).toBe('保持内容')
  })

  it('routes attachment preview, remove and ordering once', async () => {
    const onPreview = vi.fn()
    const onMove = vi.fn()
    const onRemove = vi.fn()
    render(
      <ConversationAttachments
        items={[
          { id: 'image-1', label: '参考图1', previewUrl: 'data:image/png;base64,a' },
          { id: 'image-2', label: '参考图2', previewUrl: 'data:image/png;base64,b' },
        ]}
        onPreview={onPreview}
        onMove={onMove}
        onRemove={onRemove}
      />,
    )
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '预览参考图1' }))
    await user.click(screen.getByRole('button', { name: '移除参考图1' }))

    expect(onPreview).toHaveBeenCalledWith('image-1', 0)
    expect(onRemove).toHaveBeenCalledOnce()
    const first = document.querySelector<HTMLElement>('[data-composer-attachment-index="0"]')!
    const second = document.querySelector<HTMLElement>('[data-composer-attachment-index="1"]')!
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => second })
    fireEvent.touchStart(first, { touches: [{ clientX: 10, clientY: 10 }] })
    fireEvent.touchMove(first, { touches: [{ clientX: 50, clientY: 10 }] })
    fireEvent.touchEnd(first)
    expect(onMove).toHaveBeenCalledOnce()
    expect(onMove).toHaveBeenCalledWith(0, 2)

    onMove.mockClear()
    fireEvent.touchStart(first, { touches: [{ clientX: 10, clientY: 10 }] })
    fireEvent.touchMove(first, { touches: [{ clientX: 50, clientY: 10 }] })
    fireEvent.touchCancel(first)
    expect(onMove).not.toHaveBeenCalled()
  })
})

describe('Sub2ImageConversationComposer', () => {
  it('reads and writes the shared draft, attachments and params', async () => {
    render(<Sub2ImageConversationComposer />)
    const editor = screen.getByRole('textbox', { name: '图片提示词输入' })
    const user = userEvent.setup()

    await user.click(editor)
    await user.type(editor, '共享草稿')
    expect(useStore.getState().prompt).toBe('共享草稿')

    act(() => {
      useStore.getState().setPrompt('旧输入框更新')
      useStore.getState().addInputImage({ id: 'image-1', dataUrl: 'data:image/png;base64,a' })
      useStore.getState().setParams({ quality: 'high' })
    })

    await waitFor(() => expect(editor.textContent).toBe('旧输入框更新'))
    expect(screen.getByRole('button', { name: '预览参考图1' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '生成设置' }))
    expect(screen.getByRole('group', { name: '生成类型' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '生成类型 图片' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '比例 自动' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '分辨率 1K' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '生成数量 1x' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '格式 PNG' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '透明背景 关闭' })).toBeTruthy()
    expect(screen.queryByRole('group', { name: '质量' })).toBeNull()
    expect(screen.queryByRole('spinbutton', { name: '输出压缩' })).toBeNull()
    expect(screen.queryByRole('group', { name: '审核强度' })).toBeNull()
    // 设置浮层内提供模型选择区（2026-07 需求：模型选择整合进 composer）
    expect(screen.getByRole('group', { name: '生成模型' })).toBeTruthy()
    expect(screen.getByRole('dialog', { name: '图片设置' })).toBeTruthy()
  })

  it('selects Prompt Agent first and waits for send before opening questions', async () => {
    useStore.getState().setPrompt('先选择再发送')
    render(<Sub2ImageConversationComposer />)
    const user = userEvent.setup()
    const agent = document.querySelector<HTMLButtonElement>('.cc-agent-button')!

    // 提示词库入口已整合进 composer 工具栏（2026-07 需求）
    expect(document.querySelector('[data-conversation-composer-dock] [title="提示词库"]')).not.toBeNull()
    await user.click(agent)

    // 选中后 Agent 按钮会切换为液态样式的新元素，需要重新查询
    const agentSelected = document.querySelector<HTMLButtonElement>('.cc-agent-button')!
    expect(agentSelected.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('textbox', { name: '图片提示词输入' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '发送到图片提示词 Agent' })).toBeTruthy()
    expect(document.querySelector('[data-prompt-agent-card]')).toBeNull()
    expect(mocks.submitTask).not.toHaveBeenCalled()
  })

  it('applies settings changes immediately without a save button', async () => {
    render(<Sub2ImageConversationComposer />)
    const user = userEvent.setup()
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--composer-stack-clearance')).not.toBe(''))
    const clearance = document.documentElement.style.getPropertyValue('--composer-stack-clearance')

    await user.click(screen.getByRole('button', { name: '生成设置' }))
    expect(document.documentElement.style.getPropertyValue('--composer-stack-clearance')).toBe(clearance)
    // 输入框在设置浮层打开时保持可见
    expect(screen.getByRole('textbox', { name: '图片提示词输入' })).toBeTruthy()
    // 没有保存按钮，选中即生效
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull()

    await user.click(screen.getByRole('button', { name: '比例 16:9' }))
    await user.click(screen.getByRole('button', { name: '分辨率 2K' }))
    await user.click(screen.getByRole('button', { name: '生成数量 x2' }))
    await user.click(screen.getByRole('button', { name: '格式 JPEG' }))
    await user.click(screen.getByRole('button', { name: '透明背景 开启' }))
    await user.click(document.querySelector<HTMLElement>('.cc-settings-overlay')!)
    expect(useStore.getState().params).toMatchObject({
      size: '2560x1440',
      n: 2,
      output_format: 'jpeg',
      transparent_output: true,
    })
    expect(screen.queryByRole('dialog', { name: '图片设置' })).toBeNull()
  })

  it('switches image and video inside generation settings without changing Agent workspace', async () => {
    render(<Sub2ImageConversationComposer />)
    const user = userEvent.setup()

    expect(screen.queryByRole('group', { name: '生成类型' })).toBeNull()
    expect(useStore.getState().appMode).toBe('gallery')
    expect(document.querySelector('[data-generation-icon="image"]')).toBeTruthy()
    // 触发按钮显示当前生效的图片模型名（2026-07 需求）
    expect(screen.getByRole('button', { name: '生成设置' }).textContent).toContain('gpt-image-2')
    await user.click(screen.getByRole('button', { name: '生成设置' }))
    await user.click(screen.getByRole('button', { name: '生成类型 视频' }))

    expect(screen.getByRole('textbox', { name: '视频提示词输入' })).toBeTruthy()
    expect(document.querySelector('[data-generation-icon="video"]')).toBeTruthy()
    // 未配置视频模型时提示选择模型
    expect(screen.getByRole('button', { name: '生成设置' }).textContent).toContain('选择模型')
    expect(screen.getByRole('dialog', { name: '视频设置' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '生成类型 视频' }).getAttribute('aria-pressed')).toBe('true')
    expect(useStore.getState().appMode).toBe('gallery')
    expect(document.querySelector('.cc-agent-button')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^时长 / })).toHaveLength(6)
    expect(screen.getAllByRole('button', { name: /^生成数量 / })).toHaveLength(4)
    expect(screen.getAllByRole('button', { name: /^画面比例 / })).toHaveLength(2)
    expect(screen.getByRole('button', { name: '画面比例 9:16' }).querySelector('.cc-settings-option-icon')).toBeTruthy()
    expect(screen.getByRole('button', { name: '画面比例 16:9' }).querySelector('.cc-settings-option-icon')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '时长 12 秒' }))
    await user.click(screen.getByRole('button', { name: '生成数量 4 个' }))
    await user.click(screen.getByRole('button', { name: '画面比例 9:16' }))
    expect(useStore.getState().settings.videoParams).toEqual({
      duration: 12,
      aspectRatio: '9:16',
      resolution: '720p',
      n: 4,
    })

    await user.click(document.querySelector<HTMLElement>('.cc-settings-overlay')!)
    await user.click(document.querySelector<HTMLButtonElement>('.cc-agent-button')!)
    expect(document.querySelector<HTMLButtonElement>('.cc-agent-button')?.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '发送到视频提示词 Agent' })).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '生成设置' }))
    await user.click(screen.getByRole('button', { name: '生成类型 图片' }))
    expect(screen.getByRole('textbox', { name: '图片提示词输入' })).toBeTruthy()
    expect(document.querySelector('[data-generation-icon="image"]')).toBeTruthy()
    expect(document.querySelector('.cc-agent-button')).toBeTruthy()
  })

  it('keeps thumbnails at 40px and opens mask actions through preview', async () => {
    useStore.getState().addInputImage({ id: 'image-1', dataUrl: 'data:image/png;base64,a' })
    render(<Sub2ImageConversationComposer />)
    const user = userEvent.setup()
    const attachment = document.querySelector<HTMLElement>('.cc-attachment')!
    const composer = document.querySelector<HTMLElement>('.cc-composer')!

    expect(getComputedStyle(attachment).width).toBe('40px')
    expect(getComputedStyle(attachment).height).toBe('40px')
    expect(getComputedStyle(composer).maxHeight).toContain('400px')
    expect(screen.queryByRole('button', { name: '编辑参考图1' })).toBeNull()
    await user.click(screen.getByRole('button', { name: '预览参考图1' }))
    await user.click(screen.getByRole('button', { name: '编辑遮罩' }))
    expect(useStore.getState().maskEditorImageId).toBe('image-1')
  })

  it('submits exactly once and only ingests a focused paste once', async () => {
    useStore.getState().setPrompt('单次提交')
    render(<Sub2ImageConversationComposer />)
    const editor = screen.getByRole('textbox', { name: '图片提示词输入' })
    const user = userEvent.setup()

    expect(getActiveApiProfile(useStore.getState().settings).apiKey).toBe('test-key')
    await user.click(screen.getByRole('button', { name: '生成图片' }))
    expect(useStore.getState().showSettings).toBe(false)
    expect(mocks.submitTask).toHaveBeenCalledOnce()
    expect(mocks.submitAgentMessage).not.toHaveBeenCalled()

    editor.focus()
    expect(isComposerFocused(NEXT_COMPOSER_OWNER)).toBe(true)
    const file = new File(['image'], 'paste.png', { type: 'image/png' })
    fireEvent.paste(editor, {
      clipboardData: {
        items: [{ type: 'image/png', getAsFile: () => file }],
        getData: () => '',
      },
    })

    await waitFor(() => expect(mocks.addImageFromFile).toHaveBeenCalledOnce())
  })

  it('routes Agent through the Chat Tool once', async () => {
    const state = useStore.getState()
    const profile = { ...getActiveApiProfile(state.settings), apiMode: 'responses' as const }
    useStore.setState({
      settings: {
        ...state.settings,
        profiles: [profile],
        activeProfileId: profile.id,
        apiMode: 'responses',
        agentApiConfigMode: 'off',
      },
      appMode: 'agent',
    })
    render(<Sub2ImageConversationComposer />)
    const user = userEvent.setup()

    // 未选中 Agent：直接生成图片，不经过 Agent 文本分析
    act(() => useStore.getState().setPrompt('直接生成图片'))
    await user.click(screen.getByRole('button', { name: '发送 Agent 消息' }))

    expect(mocks.submitAgentDirectImage).toHaveBeenCalledOnce()
    expect(mocks.submitAgentMessage).not.toHaveBeenCalled()
    expect(mocks.submitTask).not.toHaveBeenCalled()

    // 选中 Agent 后：走 Agent 对话分析流程
    const agentButton = document.querySelector<HTMLButtonElement>('.cc-agent-button')
    expect(agentButton).not.toBeNull()
    await user.click(agentButton!)
    act(() => useStore.getState().setPrompt('Agent 单次提交'))
    await user.click(screen.getByRole('button', { name: '发送 Agent 消息' }))

    expect(mocks.submitAgentMessage).toHaveBeenCalledOnce()
    expect(mocks.submitTask).not.toHaveBeenCalled()
  })

  it('stops the Image Tool without invoking Agent stop', async () => {
    let signal: AbortSignal | undefined
    mocks.submitTask.mockImplementationOnce(async (options) => {
      signal = options?.signal
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal?.reason), { once: true })
      })
    })
    useStore.getState().setPrompt('停止图片请求')
    render(<Sub2ImageConversationComposer />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: '生成图片' }))
    const stop = await screen.findByRole('button', { name: '停止' })
    await user.click(stop)

    expect(signal?.aborted).toBe(true)
    expect(mocks.stopAgentResponse).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: '生成图片' })).toBeTruthy())
  })

  it('scopes Agent running state by conversation and stops legacy work', async () => {
    const state = useStore.getState()
    const profile = { ...getActiveApiProfile(state.settings), apiMode: 'responses' as const }
    const running = {
      id: 'conversation-running',
      title: '运行中',
      createdAt: 1,
      updatedAt: 1,
      rounds: [{
        id: 'round-1',
        index: 1,
        userMessageId: 'message-1',
        prompt: '处理中',
        inputImageIds: [],
        outputTaskIds: [],
        status: 'running' as const,
        error: null,
        createdAt: 1,
        finishedAt: null,
      }],
      messages: [],
    }
    const idle = { ...running, id: 'conversation-idle', title: '空闲', rounds: [] }
    useStore.setState({
      appMode: 'agent',
      settings: {
        ...state.settings,
        profiles: [profile],
        activeProfileId: profile.id,
        apiMode: 'responses',
        agentApiConfigMode: 'off',
      },
      agentConversations: [running, idle],
      activeAgentConversationId: idle.id,
      prompt: '空闲会话消息',
    })
    render(<Sub2ImageConversationComposer />)

    expect(screen.getByRole('button', { name: '发送 Agent 消息' })).toBeTruthy()
    act(() => useStore.getState().setActiveAgentConversationId(running.id))
    const stop = await screen.findByRole('button', { name: '停止' })
    await userEvent.click(stop)

    expect(mocks.stopAgentResponse).toHaveBeenCalledWith(running.id)
  })

  it('selects a current image mention without losing its stable marker', async () => {
    useStore.getState().addInputImage({ id: 'image-1', dataUrl: 'data:image/png;base64,a' })
    render(<Sub2ImageConversationComposer />)
    const editor = screen.getByRole('textbox', { name: '图片提示词输入' })
    const user = userEvent.setup()

    await user.click(editor)
    await user.type(editor, '@')
    await user.click(await screen.findByRole('button', { name: '选择 @图1' }))

    expect(useStore.getState().prompt).toBe(getSelectedImageMentionLabel(0))
    expect(editor.querySelector('.cc-atom')?.textContent).toBe('@图1')
  })

  it('does not select the mention menu while IME is composing', async () => {
    useStore.getState().addInputImage({ id: 'image-1', dataUrl: 'data:image/png;base64,a' })
    render(<Sub2ImageConversationComposer />)
    const editor = screen.getByRole('textbox', { name: '图片提示词输入' })
    const user = userEvent.setup()

    await user.click(editor)
    await user.type(editor, '@')
    await screen.findByRole('button', { name: '选择 @图1' })
    fireEvent.compositionStart(editor)
    fireEvent.keyDown(editor, { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true })

    expect(useStore.getState().prompt).toBe('@')
    expect(editor.querySelector('.cc-atom')).toBeNull()
  })

  it('routes image paste and page drop to the single focused Composer', async () => {
    render(<Sub2ImageConversationComposer />)
    const editor = screen.getByRole('textbox', { name: '图片提示词输入' })
    const file = new File(['image'], 'owner.png', { type: 'image/png' })
    const clipboardData = {
      items: [{ type: 'image/png', getAsFile: () => file }],
      getData: () => '',
    }
    const dropData = {
      files: [file],
      items: [],
      types: ['Files'],
      getData: () => '',
    }

    editor.focus()
    fireEvent.paste(editor, { clipboardData })
    await waitFor(() => expect(mocks.addImageFromFile).toHaveBeenCalledOnce())
    mocks.addImageFromFile.mockClear()
    expect(isComposerFocused(NEXT_COMPOSER_OWNER)).toBe(true)
    fireEvent.drop(document.body, { dataTransfer: dropData })
    await waitFor(() => expect(mocks.addImageFromFile).toHaveBeenCalledOnce())
  })
})
