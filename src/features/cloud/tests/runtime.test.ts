// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FavoriteCollection, TaskRecord } from '../../../types'
import { DEFAULT_PARAMS } from '../../../types'
import type { CloudAccount, CloudAsset, CloudBootstrap, CloudSkill, CloudTask } from '../types'

const mock = vi.hoisted(() => ({
  token: 'token-a',
  store: {
    tasks: [] as TaskRecord[],
    favoriteCollections: [] as FavoriteCollection[],
    settings: { cloudAutoSave: false },
    filterCloud: false,
    setTasks: vi.fn(),
    setFavoriteCollections: vi.fn(),
    setFilterCloud: vi.fn(),
    setSettings: vi.fn(),
    showToast: vi.fn(),
  },
  getUploadedAgentSkillDoc: vi.fn(),
  restoreAgentSkill: vi.fn(),
  getCloudAccount: vi.fn(),
  listCloudTasks: vi.fn(),
  removeCloudSkill: vi.fn(),
  removeCloudTask: vi.fn(),
  saveCloudSkill: vi.fn(),
  clearCloudAssetRegistry: vi.fn(),
  ensureCloudAssetCached: vi.fn(),
  loadCloudBootstrap: vi.fn(),
  registerCloudAssets: vi.fn(),
  putTask: vi.fn(),
  saveTaskToCloud: vi.fn(),
}))

vi.mock('../../../Skills', () => ({
  agentSkills: [
    { id: 'local-choice', name: '保留本地' },
    { id: 'cloud-choice', name: '使用云端' },
  ],
  getUploadedAgentSkillDoc: mock.getUploadedAgentSkillDoc,
  restoreAgentSkill: mock.restoreAgentSkill,
}))

vi.mock('../../../lib/sub2api', () => ({
  getSub2Token: () => mock.token,
  OPEN_SUB2_CONNECT_EVENT: 'sub2-connect',
  SUB2_AUTH_CHANGED_EVENT: 'sub2-auth-changed',
  SUB2_AUTH_STORAGE_KEY: 'image2.sub2api.user',
}))

vi.mock('../../../state/appStore', () => ({
  useStore: Object.assign(vi.fn(), { getState: () => mock.store }),
}))

vi.mock('../../tasks/taskPersistence', () => ({ putTask: mock.putTask }))

vi.mock('../api', () => ({
  getCloudAccount: mock.getCloudAccount,
  listCloudTasks: mock.listCloudTasks,
  removeCloudSkill: mock.removeCloudSkill,
  removeCloudTask: mock.removeCloudTask,
  saveCloudSkill: mock.saveCloudSkill,
}))

vi.mock('../cache', () => ({
  clearCloudAssetRegistry: mock.clearCloudAssetRegistry,
  ensureCloudAssetCached: mock.ensureCloudAssetCached,
  loadCloudBootstrap: mock.loadCloudBootstrap,
  registerCloudAssets: mock.registerCloudAssets,
}))

vi.mock('../taskUpload', () => ({ saveTaskToCloud: mock.saveTaskToCloud }))

function account(id: string): CloudAccount {
  return {
    id: `account-${id}`,
    provider: 'sub2api',
    externalUserId: id,
    usedBytes: 0,
    quotaBytes: 1024,
    createdAt: '2026-07-23T00:00:00.000Z',
    lastSeenAt: '2026-07-23T00:00:00.000Z',
  }
}

function task(id: string): TaskRecord {
  return {
    id,
    prompt: id,
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
  }
}

function cloudTask(id: string, savedTask: TaskRecord = task(id)): CloudTask {
  return {
    id,
    task: savedTask,
    assets: [],
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  }
}

function skill(id: string, markdown: string): CloudSkill {
  return {
    id,
    version: 1,
    fileName: `${id}.md`,
    markdown,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  }
}

function bootstrap(id: string, tasks: CloudTask[] = [], skills: CloudSkill[] = []): CloudBootstrap {
  return { account: account(id), tasks, skills }
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  mock.token = 'token-a'
  mock.store.tasks = []
  mock.store.favoriteCollections = []
  mock.store.settings = { cloudAutoSave: false }
  mock.store.filterCloud = false
  mock.store.setTasks.mockImplementation((tasks) => {
    mock.store.tasks = tasks
  })
  mock.store.setFavoriteCollections.mockImplementation((collections) => {
    mock.store.favoriteCollections = collections
  })
  mock.store.setFilterCloud.mockImplementation((value) => {
    mock.store.filterCloud = value
  })
  mock.store.setSettings.mockImplementation((settings) => {
    mock.store.settings = { ...mock.store.settings, ...settings }
  })
  mock.ensureCloudAssetCached.mockImplementation(async () => ({}))
  mock.listCloudTasks.mockResolvedValue([])
  mock.removeCloudSkill.mockImplementation(async () => undefined)
  mock.removeCloudTask.mockImplementation(async () => undefined)
  mock.saveCloudSkill.mockImplementation(async (id, version, fileName, markdown) =>
    skill(id, markdown),
  )
})

describe('云端运行时', () => {
  it('bootstrap 合并远端任务和素材集，不覆盖本地任务', async () => {
    const local = task('local-task')
    const remote = task('remote-task') as TaskRecord & { cloudFavoriteCollections: FavoriteCollection[] }
    remote.favoriteCollectionIds = ['remote-collection']
    remote.cloudFavoriteCollections = [{ id: 'remote-collection', name: '云端素材集', createdAt: 2, updatedAt: 2 }]
    mock.store.tasks = [local]
    mock.store.favoriteCollections = [{ id: 'local-collection', name: '本地素材集', createdAt: 1, updatedAt: 1 }]
    mock.loadCloudBootstrap.mockResolvedValue(bootstrap('user-a', [cloudTask(remote.id, remote)]))

    const runtime = await import('../runtime')
    await runtime.syncCloudData()

    expect(mock.putTask).toHaveBeenCalledWith(expect.not.objectContaining({ cloudFavoriteCollections: expect.anything() }))
    expect(mock.store.tasks.map((item) => item.id)).toEqual(['remote-task', 'local-task'])
    expect(mock.store.favoriteCollections.map((item) => item.id)).toEqual(['local-collection', 'remote-collection'])
    expect(runtime.getCloudRuntimeState().tasks['remote-task']).toEqual({ status: 'saved' })
  })

  it('Skill 冲突时分别支持保留本地和使用云端', async () => {
    mock.getUploadedAgentSkillDoc.mockImplementation((id) => ({
      id,
      version: 2,
      fileName: `${id}.md`,
      raw: `local-${id}`,
    }))
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    mock.loadCloudBootstrap.mockResolvedValue(bootstrap('user-a', [], [
      skill('local-choice', 'cloud-local-choice'),
      skill('cloud-choice', 'cloud-cloud-choice'),
    ]))

    const runtime = await import('../runtime')
    await runtime.syncCloudData()

    expect(mock.saveCloudSkill).toHaveBeenCalledWith('local-choice', 2, 'local-choice.md', 'local-local-choice', expect.anything())
    expect(mock.restoreAgentSkill).toHaveBeenCalledWith('cloud-cloud-choice', 'cloud-choice.md', true)
    expect(runtime.getCloudRuntimeState().skills).toEqual({
      'local-choice': { status: 'saved' },
      'cloud-choice': { status: 'saved' },
    })
  })

  it('只在开启自动保存且已登录时上传新完成任务', async () => {
    const savedTask = task('auto-task')
    const collection = { id: 'collection-1', name: '自动保存', createdAt: 1, updatedAt: 1 }
    savedTask.favoriteCollectionIds = [collection.id]
    mock.store.favoriteCollections = [collection]
    mock.saveTaskToCloud.mockResolvedValue(cloudTask(savedTask.id, savedTask))

    const runtime = await import('../runtime')
    await runtime.autoSaveTaskToCloud(savedTask)
    expect(mock.saveTaskToCloud).not.toHaveBeenCalled()

    mock.store.settings.cloudAutoSave = true
    await runtime.autoSaveTaskToCloud(savedTask)
    expect(mock.saveTaskToCloud).toHaveBeenCalledWith(
      expect.objectContaining({ cloudFavoriteCollections: [collection] }),
      expect.any(Object),
    )
    expect(runtime.getCloudRuntimeState().tasks[savedTask.id]).toEqual({ status: 'saved' })
  })

  it('移出任务前缓存并持久化远端最新版本', async () => {
    const local = task('remove-task')
    local.prompt = 'local-v1'
    const latest = {
      ...local,
      prompt: 'remote-v2',
      outputImages: ['output-2'],
      outputVideoIds: ['video-1'],
      transparentOriginalImages: ['original-1'],
    }
    mock.store.tasks = [local]

    const assets = [
      { id: 'cloud-shared-image', assetId: 'original-1', role: 'original', index: 0 } as CloudTask['assets'][number],
      { id: 'cloud-shared-image', assetId: 'output-2', role: 'output', index: 0 } as CloudTask['assets'][number],
      { id: 'cloud-video', assetId: 'video-1', role: 'video', index: 0 } as CloudTask['assets'][number],
    ]
    const calls: string[] = []
    mock.listCloudTasks.mockImplementation(async () => {
      calls.push('list')
      return [{ ...cloudTask(local.id, latest), assets }]
    })
    mock.ensureCloudAssetCached.mockImplementation(async (asset) => {
      calls.push(`cache:${asset.assetId}`)
      return {}
    })
    mock.putTask.mockImplementation(async (saved) => {
      calls.push(`persist:${saved.prompt}`)
    })
    mock.removeCloudTask.mockImplementation(async (id) => {
      calls.push(`remove:${id}`)
    })

    const runtime = await import('../runtime')
    const removing = runtime.removeTaskFromCloud(local.id)

    expect(runtime.getCloudRuntimeState().tasks[local.id]).toEqual({ status: 'removing' })
    await removing

    expect(calls).toEqual([
      'list',
      'cache:original-1',
      'cache:output-2',
      'cache:video-1',
      'persist:remote-v2',
      'remove:remove-task',
    ])
    expect(mock.listCloudTasks).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(mock.store.tasks[0].prompt).toBe('remote-v2')
    expect(mock.removeCloudTask).toHaveBeenCalledWith(local.id, expect.any(AbortSignal))
    expect(runtime.getCloudRuntimeState().tasks[local.id]).toBeUndefined()
  })

  it('移出 Skill 期间使用 removing 状态', async () => {
    let resolve: () => void = () => undefined
    mock.removeCloudSkill.mockReturnValue(new Promise<void>((done) => {
      resolve = done
    }))

    const runtime = await import('../runtime')
    const removing = runtime.removeSkillFromCloud('skill-1')

    expect(runtime.getCloudRuntimeState().skills['skill-1']).toEqual({ status: 'removing' })
    expect(mock.removeCloudSkill).toHaveBeenCalledWith('skill-1', expect.any(AbortSignal))
    resolve()
    await removing
    expect(runtime.getCloudRuntimeState().skills['skill-1']).toBeUndefined()
  })

  it('账号切换时丢弃旧 bootstrap，并在旧请求结束后加载新账号', async () => {
    let resolveOld: (data: CloudBootstrap) => void = () => undefined
    const oldData = new Promise<CloudBootstrap>((resolve) => {
      resolveOld = resolve
    })
    mock.loadCloudBootstrap
      .mockReturnValueOnce(oldData)
      .mockResolvedValueOnce(bootstrap('user-b', [cloudTask('task-b')]))
      .mockResolvedValueOnce(bootstrap('user-c'))
      .mockResolvedValueOnce(bootstrap('user-d'))

    const runtime = await import('../runtime')
    const first = runtime.initCloudRuntime()
    await vi.waitFor(() => expect(mock.loadCloudBootstrap).toHaveBeenCalledTimes(1))

    mock.token = 'token-b'
    window.dispatchEvent(new StorageEvent('storage', { key: 'image2.sub2api.user' }))
    resolveOld(bootstrap('user-a', [cloudTask('task-a')]))
    await first

    await vi.waitFor(() => {
      expect(mock.loadCloudBootstrap).toHaveBeenCalledTimes(2)
      expect(runtime.getCloudRuntimeState().account?.externalUserId).toBe('user-b')
    })
    expect(runtime.getCloudRuntimeState().tasks).toEqual({ 'task-b': { status: 'saved' } })
    expect(mock.putTask).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'task-a' }))

    mock.saveTaskToCloud.mockImplementation((_task, options) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal?.reason))
    }))
    const saving = runtime.saveTaskWithCloudState(task('saving-task'))
    await vi.waitFor(() => expect(mock.saveTaskToCloud).toHaveBeenCalledOnce())
    mock.token = 'token-c'
    window.dispatchEvent(new Event('sub2-auth-changed'))

    await expect(saving).rejects.toThrow('云端保存已取消')
    await vi.waitFor(() => expect(runtime.getCloudRuntimeState().account?.externalUserId).toBe('user-c'))
    expect(runtime.getCloudRuntimeState().tasks).toEqual({})

    const removingTask = task('removing-task')
    removingTask.transparentOriginalImages = ['original-1']
    mock.store.tasks = [removingTask]
    mock.listCloudTasks.mockResolvedValue([{
      ...cloudTask(removingTask.id, removingTask),
      assets: [{
        id: 'cloud-original',
        assetId: 'original-1',
        role: 'original',
        index: 0,
      } as CloudTask['assets'][number]],
    }])
    mock.ensureCloudAssetCached.mockImplementation((_asset: CloudAsset, signal?: AbortSignal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(signal.reason))
    }))

    const removing = runtime.removeTaskFromCloud(removingTask.id)
    await vi.waitFor(() => expect(runtime.getCloudRuntimeState().tasks[removingTask.id]).toEqual({ status: 'removing' }))
    mock.token = 'token-d'
    window.dispatchEvent(new Event('sub2-auth-changed'))

    await expect(removing).rejects.toThrow('移出云端已取消')
    expect(mock.removeCloudTask).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(runtime.getCloudRuntimeState().account?.externalUserId).toBe('user-d'))
  })
})
