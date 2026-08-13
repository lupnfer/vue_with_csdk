import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import SdkView from '../../src/renderer/src/views/SdkView.vue'
import type { RendererApi } from '../../src/shared/ipc/api'

beforeEach(() => {
  const off = vi.fn()
  window.api = {
    ping: vi.fn(),
    getVersion: vi.fn(),
    sdk: {
      init: vi.fn().mockResolvedValue({ id: 1 }),
      open: vi.fn().mockResolvedValue({ id: 2 }),
      startScan: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      disposeSession: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockImplementation((_event, cb) => {
        // 模拟立即投递一个事件
        setTimeout(() => cb({ handleId: 2, eventType: 1, payload: '{"status":"started"}' }), 0)
        return () => {}
      })
    }
  } as unknown as RendererApi
})

describe('SdkView', () => {
  it('点击按钮后显示 session/handle 与事件', async () => {
    const wrapper = mount(SdkView)
    await wrapper.find('button').trigger('click')
    // 等待 Promise + setTimeout
    await new Promise((r) => setTimeout(r, 10))
    expect(wrapper.text()).toContain('session: 1')
    expect(wrapper.text()).toContain('handle: 2')
    expect(wrapper.text()).toContain('started')
  })
})
