import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import SocketView from '../../src/renderer/src/views/SocketView.vue'
import type { RendererApi } from '../../src/shared/ipc/api'

beforeEach(() => {
  window.api = {
    ping: vi.fn(),
    getVersion: vi.fn(),
    sdk: { discover: vi.fn().mockResolvedValue([]) },
    db: { getAppConfig: vi.fn(), setAppConfig: vi.fn(), deleteAppConfig: vi.fn(), listAppConfig: vi.fn().mockResolvedValue([]), getSecretConfig: vi.fn(), setSecretConfig: vi.fn(), deleteSecretConfig: vi.fn(), listSecretConfig: vi.fn().mockResolvedValue([]) },
    http: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), setToken: vi.fn(), setRefreshToken: vi.fn(), clearTokens: vi.fn() },
    socket: { modifyIp: vi.fn().mockResolvedValue({ ok: true }) },
    useCase: { configLoadAuth: vi.fn().mockResolvedValue({ sdkSession: { id: 1 } }) }
  } as unknown as RendererApi
})

describe('SocketView', () => {
  it('填表点按钮触发 modifyIp 并显示已发送', async () => {
    const wrapper = mount(SocketView, { global: { stubs: { RouterLink: true } } })
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('00:11:22:33:44:55')
    await inputs[1].setValue('192.168.1.100')
    await inputs[2].setValue('255.255.255.0')
    await inputs[3].setValue('192.168.1.1')
    await wrapper.find('button').trigger('click')
    await new Promise((r) => setTimeout(r, 10))
    expect(window.api.socket.modifyIp).toHaveBeenCalledWith({
      mac: '00:11:22:33:44:55', newIp: '192.168.1.100', mask: '255.255.255.0', gateway: '192.168.1.1'
    })
    expect(wrapper.text()).toContain('已发送')
  })
})
