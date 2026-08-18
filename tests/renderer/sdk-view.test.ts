import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import SdkView from '../../src/renderer/src/views/SdkView.vue'
import type { RendererApi } from '../../src/shared/ipc/api'

beforeEach(() => {
  window.api = {
    ping: vi.fn(),
    getVersion: vi.fn(),
    sdk: {
      discover: vi.fn().mockResolvedValue([
        {
          mac: '00:11:22:33:44:55',
          type: 'IPC-MOCK',
          version: 'V1.0-mock',
          name: 'Mock-Camera-01',
          ip: '192.168.1.100',
          mask: '255.255.255.0',
          gateway: '192.168.1.1',
          serialNumber: 'MOCK-SN-001',
          dhcpEnabled: 1,
          publicVersion: 'V500R019C30-mock',
          isActive: true
        }
      ])
    },
    db: {
      getAppConfig: vi.fn(),
      setAppConfig: vi.fn(),
      deleteAppConfig: vi.fn(),
      listAppConfig: vi.fn().mockResolvedValue([]),
      getSecretConfig: vi.fn(),
      setSecretConfig: vi.fn(),
      deleteSecretConfig: vi.fn(),
      listSecretConfig: vi.fn().mockResolvedValue([])
    },
    http: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      setToken: vi.fn(),
      setRefreshToken: vi.fn(),
      clearTokens: vi.fn()
    },
    useCase: {
      configLoadAuth: vi.fn().mockResolvedValue({ sdkSession: { id: 1 } })
    }
  } as unknown as RendererApi
})

describe('SdkView', () => {
  it('点击按钮后显示发现的设备', async () => {
    const wrapper = mount(SdkView, { global: { stubs: { RouterLink: true } } })
    await wrapper.find('button').trigger('click')
    // 等待 Promise
    await new Promise((r) => setTimeout(r, 10))
    expect(window.api.sdk.discover).toHaveBeenCalled()
    expect(wrapper.text()).toContain('Mock-Camera-01')
    expect(wrapper.text()).toContain('192.168.1.100')
    expect(wrapper.text()).toContain('00:11:22:33:44:55')
  })
})
