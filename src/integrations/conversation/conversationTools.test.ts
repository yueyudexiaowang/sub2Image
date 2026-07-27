import { describe, expect, it, vi } from 'vitest'
import { createDefaultOpenAIProfile, normalizeSettings } from '../../lib/apiProfiles'
import { useStore } from '../../store'
import { createConversationRuntime, type ConversationMessageProps, type ConversationSubmitInput, type ConversationTool } from '../../features/conversationComposer'
import { createMessageRendererRegistry } from '../../features/conversationView'
import {
  conversationTools,
  SUB2_CANVAS_TOOL_ID,
  SUB2_CHAT_TOOL_ID,
  SUB2_IMAGE_TOOL_ID,
  SUB2_VIDEO_TOOL_ID,
} from './conversationTools'
import { createSub2ImageChatTool } from './sub2ImageChatTool'
import { createSub2ImageImageTool } from './sub2ImageImageTool'
import { registerSub2ImageMessageRenderers } from './conversationMessageRenderers'

const input: ConversationSubmitInput = {
  text: '生成一张图片',
  attachments: [],
  params: { size: '1024x1024' },
}

const draft = {
  prompt: input.text,
  inputImages: [],
  maskDraft: null,
  params: { size: '1024x1024' as const },
}

const createSettings = (apiMode: 'images' | 'responses') => {
  const profile = createDefaultOpenAIProfile({
    id: `${apiMode}-profile`,
    apiKey: 'test-key',
    apiMode,
  })
  return normalizeSettings({
    profiles: [profile],
    activeProfileId: profile.id,
    agentApiConfigMode: 'off',
  })
}

describe('sub2Image conversation Tools', () => {
  it('registers a newly loaded Tool renderer into the host registry', async () => {
    const Renderer = (_props: ConversationMessageProps) => null
    const registry = createMessageRendererRegistry()
    const tool: ConversationTool = {
      id: 'dummy',
      label: 'Dummy',
      getComposerState: ({ running }) => ({
        placeholder: 'Dummy',
        canSubmit: !running,
        validationError: null,
        running,
      }),
      load: async () => ({
        messageRenderers: { 'dummy/result': Renderer },
        validate: () => null,
        submit: async () => undefined,
      }),
    }
    const runtime = createConversationRuntime({
      tools: [tool],
      onToolLoaded: (_toolId, module) => registerSub2ImageMessageRenderers(module.messageRenderers, registry),
    })

    await runtime.loadTool(tool.id)

    expect(registry.get('dummy/result')).toBe(Renderer)
  })

  it('registers image, video, Agent chat and canvas Tools', () => {
    expect(conversationTools.map((tool) => tool.id)).toEqual([SUB2_IMAGE_TOOL_ID, SUB2_VIDEO_TOOL_ID, SUB2_CHAT_TOOL_ID, SUB2_CANVAS_TOOL_ID])
  })

  it('provides Chat state and routes submit and stop through the adapter', async () => {
    const submit = vi.fn(async () => undefined)
    const stop = vi.fn()
    const state = {
      ...useStore.getState(),
      settings: createSettings('responses'),
      agentConversations: [{
        id: 'conversation-1',
        title: '测试',
        createdAt: 1,
        updatedAt: 1,
        rounds: [],
        messages: [],
      }],
    }
    const tool = createSub2ImageChatTool({ getState: () => state, submit, stop })

    expect(tool.getComposerState({ conversationId: 'conversation-1', input, running: false })).toEqual({
      placeholder: '输入消息...',
      canSubmit: true,
      validationError: null,
      running: false,
    })

    const module = await tool.load()
    const controller = new AbortController()
    const ctx = {
      conversationId: 'conversation-1',
      toolId: tool.id,
      requestId: 'request-1',
      appendMessage: vi.fn(),
      getState: () => undefined,
      setState: vi.fn(),
      isCurrent: () => true,
    }
    await module.submit({ ...input, payload: { draft, editingRoundId: 'round-1' } }, ctx, controller.signal)
    module.stop?.(ctx)

    expect(submit).toHaveBeenCalledWith({
      signal: controller.signal,
      draft,
      conversationId: 'conversation-1',
      editingRoundId: 'round-1',
    })
    expect(stop).toHaveBeenCalledWith('conversation-1')
    expect(module.validate({ ...input, text: ' ' })).toBe('请输入消息')
    expect(Object.keys(module.messageRenderers)).toEqual([
      'chat/text',
      'agent/web-search',
      'agent/image-task',
    ])
  })

  it('loads Image Controls lazily and passes the Runtime signal to submitTask', async () => {
    const submit = vi.fn(async () => undefined)
    const state = {
      ...useStore.getState(),
      settings: createSettings('images'),
      reusedTaskApiProfileId: null,
    }
    const tool = createSub2ImageImageTool({ getState: () => state, submit })
    const composerState = tool.getComposerState({ conversationId: 'gallery', input, running: false })

    expect(composerState).toEqual({
      placeholder: '描述你想生成的图片...',
      canSubmit: true,
      validationError: null,
      running: false,
    })

    const module = await tool.load()
    const controller = new AbortController()
    await module.submit({ ...input, payload: { draft } }, {
      conversationId: 'gallery',
      toolId: tool.id,
      requestId: 'request-1',
      appendMessage: vi.fn(),
      getState: () => undefined,
      setState: vi.fn(),
      isCurrent: () => true,
    }, controller.signal)

    expect(module.Controls).toBeTypeOf('function')
    expect(submit).toHaveBeenCalledWith({ signal: controller.signal, draft })
    expect(module.validate({ ...input, text: '' })).toBe('请输入提示词')
    expect(Object.keys(module.messageRenderers)).toEqual(['image-generation/result'])
  })

  it('submits gallery images with the configured hybrid image profile', async () => {
    const submit = vi.fn(async () => undefined)
    const textProfile = createDefaultOpenAIProfile({ id: 'text-profile', apiKey: 'text-key', apiMode: 'responses' })
    const imageProfile = createDefaultOpenAIProfile({ id: 'image-profile', apiKey: 'image-key', apiMode: 'images' })
    const state = {
      ...useStore.getState(),
      settings: normalizeSettings({
        profiles: [textProfile, imageProfile],
        activeProfileId: textProfile.id,
        agentApiConfigMode: 'hybrid',
        agentTextProfileId: textProfile.id,
        agentImageProfileId: imageProfile.id,
      }),
      reusedTaskApiProfileId: null,
    }
    const tool = createSub2ImageImageTool({ getState: () => state, submit })
    const module = await tool.load()
    const controller = new AbortController()

    await module.submit({ ...input, payload: { draft } }, {
      conversationId: 'gallery',
      toolId: tool.id,
      requestId: 'request-1',
      appendMessage: vi.fn(),
      getState: () => undefined,
      setState: vi.fn(),
      isCurrent: () => true,
    }, controller.signal)

    expect(submit).toHaveBeenCalledWith({
      signal: controller.signal,
      draft,
      apiProfileId: imageProfile.id,
    })
  })

  it('keeps configuration errors separate from submit eligibility', () => {
    const state = {
      ...useStore.getState(),
      settings: normalizeSettings({}),
      reusedTaskApiProfileId: null,
    }
    const tool = createSub2ImageImageTool({ getState: () => state })
    const composerState = tool.getComposerState({ conversationId: 'gallery', input, running: false })

    expect(composerState.canSubmit).toBe(true)
    expect(composerState.validationError).toContain('API 配置不完整')
  })

  it('exposes a legacy Agent round as running', () => {
    const state = {
      ...useStore.getState(),
      settings: createSettings('responses'),
      agentConversations: [{
        id: 'conversation-1',
        title: '测试',
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
      }],
    }
    const tool = createSub2ImageChatTool({ getState: () => state })

    expect(tool.getComposerState({ conversationId: 'conversation-1', input, running: false })).toMatchObject({
      canSubmit: false,
      running: true,
    })
  })

})
