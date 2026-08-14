import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import HttpView from '../../src/renderer/src/views/HttpView.vue'
import type { RendererApi } from '../../src/shared/ipc/api'

beforeEach(() => {
  window.api = {
    ping: vi.fn(),
    getVersion: vi.fn(),
    sdk: { init: vi.fn(), open: vi.fn(), startScan: vi.fn(), dispose: vi.fn(), disposeSession: vi.fn(), on: vi.fn() },
    db: { getAppConfig: vi.fn(), setAppConfig: vi.fn(), deleteAppConfig: vi.fn(), listAppConfig: vi.fn().mockResolvedValue([]), getSecretConfig: vi.fn(), setSecretConfig: vi.fn(), deleteSecretConfig: vi.fn(), listSecretConfig: vi.fn().mockResolvedValue([]) },
    http: {
      get: vi.fn().mockResolvedValue({ status: 200, body: { ok: true } }),
      post: vi.fn().mockResolvedValue({ status: 201, body: { id: 1 } }),
      put: vi.fn(),
      delete: vi.fn(),
      setToken: vi.fn().mockResolvedValue(undefined),
      setRefreshToken: vi.fn(),
      clearTokens: vi.fn()
    }
  } as unknown as RendererApi
})

describe('HttpView', () => {
  it('GET 请求返回结果', async () => {
    const wrapper = mount(HttpView, { global: { stubs: { RouterLink: true } } })
    await wrapper.find('button').trigger('click')  // 第一个按钮是"发送"
    await new Promise((r) => setTimeout(r, 10))
    expect(window.api.http.get).toHaveBeenCalledWith('/users')
    expect(wrapper.text()).toContain('ok')
  })
})
