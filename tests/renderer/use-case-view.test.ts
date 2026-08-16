import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import UseCaseView from '../../src/renderer/src/views/UseCaseView.vue'
import type { RendererApi } from '../../src/shared/ipc/api'

beforeEach(() => {
  window.api = {
    ping: vi.fn(),
    getVersion: vi.fn(),
    sdk: { init: vi.fn(), open: vi.fn(), startScan: vi.fn(), dispose: vi.fn(), disposeSession: vi.fn(), on: vi.fn() },
    db: { getAppConfig: vi.fn(), setAppConfig: vi.fn(), deleteAppConfig: vi.fn(), listAppConfig: vi.fn().mockResolvedValue([]), getSecretConfig: vi.fn(), setSecretConfig: vi.fn(), deleteSecretConfig: vi.fn(), listSecretConfig: vi.fn().mockResolvedValue([]) },
    http: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), setToken: vi.fn(), setRefreshToken: vi.fn(), clearTokens: vi.fn() },
    useCase: {
      scanAndUpload: vi.fn().mockResolvedValue({ sessionId: 1, handleId: 1, events: [], uploaded: true }),
      configLoadAuth: vi.fn().mockResolvedValue({ sdkSession: { id: 1 } })
    }
  } as unknown as RendererApi
})

describe('UseCaseView', () => {
  it('扫描并上传按钮触发 scanAndUpload', async () => {
    const wrapper = mount(UseCaseView, { global: { stubs: { RouterLink: true } } })
    await wrapper.findAll('button')[1].trigger('click')  // 第二个按钮是"扫描并上传"
    await new Promise((r) => setTimeout(r, 10))
    expect(window.api.useCase.scanAndUpload).toHaveBeenCalled()
    expect(wrapper.text()).toContain('uploaded')
  })

  it('配置加载按钮触发 configLoadAuth', async () => {
    const wrapper = mount(UseCaseView, { global: { stubs: { RouterLink: true } } })
    await wrapper.findAll('button')[0].trigger('click')  // 第一个按钮是"配置加载与鉴权"
    await new Promise((r) => setTimeout(r, 10))
    expect(window.api.useCase.configLoadAuth).toHaveBeenCalled()
    expect(wrapper.text()).toContain('sdkSession')
  })
})
