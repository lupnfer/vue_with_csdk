import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import DbView from '../../src/renderer/src/views/DbView.vue'
import type { RendererApi } from '../../src/shared/ipc/api'

beforeEach(() => {
  window.api = {
    ping: vi.fn(),
    getVersion: vi.fn(),
    sdk: { init: vi.fn(), open: vi.fn(), startScan: vi.fn(), dispose: vi.fn(), disposeSession: vi.fn(), on: vi.fn() },
    db: {
      getAppConfig: vi.fn().mockResolvedValue('dark'),
      setAppConfig: vi.fn().mockResolvedValue(undefined),
      deleteAppConfig: vi.fn().mockResolvedValue(undefined),
      listAppConfig: vi.fn().mockResolvedValue([]),
      getSecretConfig: vi.fn().mockResolvedValue('secret-val'),
      setSecretConfig: vi.fn().mockResolvedValue(undefined),
      deleteSecretConfig: vi.fn().mockResolvedValue(undefined),
      listSecretConfig: vi.fn().mockResolvedValue([])
    }
  } as unknown as RendererApi
})

describe('DbView', () => {
  it('保存并读取 app_config', async () => {
    const wrapper = mount(DbView, { global: { stubs: { RouterLink: true } } })
    const inputs = wrapper.findAll('input')
    inputs[0].setValue('theme')   // appKey
    inputs[1].setValue('dark')    // appValue
    await wrapper.findAll('button')[0].trigger('click')  // 保存
    await wrapper.findAll('button')[1].trigger('click')  // 读取
    await new Promise((r) => setTimeout(r, 10))
    expect(window.api.db.setAppConfig).toHaveBeenCalledWith('theme', 'dark')
    expect(window.api.db.getAppConfig).toHaveBeenCalledWith('theme')
    expect(wrapper.text()).toContain('dark')
  })

  it('保存并读取 secret_config', async () => {
    const wrapper = mount(DbView, { global: { stubs: { RouterLink: true } } })
    const inputs = wrapper.findAll('input')
    inputs[2].setValue('api_token')  // secretKey
    inputs[3].setValue('secret-val') // secretValue
    await wrapper.findAll('button')[2].trigger('click')  // 保存
    await wrapper.findAll('button')[3].trigger('click')  // 读取
    await new Promise((r) => setTimeout(r, 10))
    expect(window.api.db.setSecretConfig).toHaveBeenCalledWith('api_token', 'secret-val')
    expect(wrapper.text()).toContain('secret-val')
  })
})
