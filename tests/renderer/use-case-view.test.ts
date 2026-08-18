import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import UseCaseView from '../../src/renderer/src/views/UseCaseView.vue'
import type { RendererApi } from '../../src/shared/ipc/api'

beforeEach(() => {
  window.api = {
    ping: vi.fn(),
    getVersion: vi.fn(),
    sdk: { discover: vi.fn().mockResolvedValue([]) },
    db: { getAppConfig: vi.fn(), setAppConfig: vi.fn(), deleteAppConfig: vi.fn(), listAppConfig: vi.fn().mockResolvedValue([]), getSecretConfig: vi.fn(), setSecretConfig: vi.fn(), deleteSecretConfig: vi.fn(), listSecretConfig: vi.fn().mockResolvedValue([]) },
    http: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), setToken: vi.fn(), setRefreshToken: vi.fn(), clearTokens: vi.fn() },
    useCase: {
      configLoadAuth: vi.fn().mockResolvedValue({ sdkSession: { id: 1 } })
    }
  } as unknown as RendererApi
})

describe('UseCaseView', () => {
  it('配置加载按钮触发 configLoadAuth', async () => {
    const wrapper = mount(UseCaseView, { global: { stubs: { RouterLink: true } } })
    await wrapper.find('button').trigger('click')
    await new Promise((r) => setTimeout(r, 10))
    expect(window.api.useCase.configLoadAuth).toHaveBeenCalled()
    expect(wrapper.text()).toContain('sdkSession')
  })
})
