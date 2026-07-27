// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSub2Token: vi.fn(() => 'token'),
  listSub2Keys: vi.fn(async () => [
    { id: 1, key: 'key-a', name: 'Key A', status: 'active', group_id: 10, group: { id: 10, name: 'usSub', platform: 'openai' } },
    { id: 2, key: 'key-b', name: 'Key B', status: 'active', group_id: 20, group: { id: 20, name: 'cnSub', platform: 'grok' } },
  ]),
  listSub2Models: vi.fn(async (key: string) => (key === 'key-a'
    ? [{ id: 'gpt-image-2' }, { id: 'gpt-5.6-sol' }]
    : [{ id: 'grok-4.5' }])),
}))

vi.mock('../../src/lib/sub2api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/lib/sub2api')>(),
  getSub2Token: mocks.getSub2Token,
  listSub2Keys: mocks.listSub2Keys,
  listSub2Models: mocks.listSub2Models,
}))

import Sub2ComposerModelSelect from '../../src/integrations/conversation/Sub2ComposerModelSelect'
import { createSub2Profile } from '../../src/lib/sub2Profiles'
import { useStore } from '../../src/store'
import type { Sub2Config } from '../../src/types'

const initialState = useStore.getState()

const imageConfig: Sub2Config = {
  id: 'agent-image-test',
  name: 'Agent 图像',
  kind: 'image',
  keyId: 2,
  keyName: 'Key B',
  groupId: 20,
  groupName: 'cnSub',
  platform: 'grok',
  model: 'grok-4.5',
  profileId: 'sub2api-image-agent-image-test',
}

beforeEach(() => {
  useStore.setState(initialState, true)
  const state = useStore.getState()
  const profile = createSub2Profile(imageConfig, 'key-b')
  useStore.setState({
    settings: {
      ...state.settings,
      sub2Configs: [imageConfig],
      profiles: [profile],
      activeProfileId: profile.id,
      agentImageProfileId: profile.id,
    },
  })
  mocks.getSub2Token.mockReturnValue('token')
  mocks.listSub2Keys.mockClear()
  mocks.listSub2Models.mockClear()
})

afterEach(() => {
  cleanup()
})

describe('Sub2ComposerModelSelect', () => {
  it('opens a grouped model list and shows all groups', async () => {
    render(<Sub2ComposerModelSelect kind="image" />)
    const user = userEvent.setup()

    const trigger = screen.getByRole('button', { name: /grok-4\.5/ })
    await user.click(trigger)

    await waitFor(() => expect(screen.getByRole('listbox', { name: '可用模型' })).toBeTruthy())
    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(3))
    expect(screen.getByText('usSub · openai')).toBeTruthy()
    expect(screen.getByText('cnSub · grok')).toBeTruthy()
    expect(screen.getByRole('option', { name: 'grok-4.5' }).className).toContain('is-active')
  })

  it('switches key and group info when selecting a model from another group', async () => {
    render(<Sub2ComposerModelSelect kind="image" />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /grok-4\.5/ }))
    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(3))
    await user.click(screen.getByRole('option', { name: 'gpt-image-2' }))

    const settings = useStore.getState().settings
    const config = settings.sub2Configs.find((item) => item.kind === 'image')!
    expect(config).toMatchObject({ model: 'gpt-image-2', keyId: 1, groupId: 10, groupName: 'usSub', platform: 'openai' })
    const profile = settings.profiles.find((item) => item.id === config.profileId)!
    expect(profile.apiKey).toBe('key-a')
    expect(profile.model).toBe('gpt-image-2')
  })

  it('falls back to the saved key models when not logged in', async () => {
    mocks.getSub2Token.mockReturnValue('')
    render(<Sub2ComposerModelSelect kind="image" />)
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: /grok-4\.5/ }))
    await waitFor(() => expect(screen.getAllByRole('option').length).toBe(1))
    // 未登录时不拉取分组列表，只展示当前 Key 下的模型（模型列表可能命中会话缓存）
    expect(mocks.listSub2Keys).not.toHaveBeenCalled()
    expect(screen.getByRole('option', { name: 'grok-4.5' })).toBeTruthy()
  })
})
