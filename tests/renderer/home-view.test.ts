import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import HomeView from '../../src/renderer/src/views/HomeView.vue'
import type { RendererApi } from '../../src/shared/ipc/api'

beforeEach(() => {
  window.api = {
    ping: vi.fn().mockResolvedValue({ ok: true }),
    getVersion: vi.fn().mockResolvedValue({
      version: '0.1.0',
      electron: '36.0.0',
      platform: 'win32'
    })
  } as unknown as RendererApi
})

describe('HomeView', () => {
  it('显示从主进程获取的应用版本', async () => {
    const wrapper = mount(HomeView, {
      global: { plugins: [createPinia()] }
    })
    await flushPromises()
    expect(wrapper.text()).toContain('0.1.0')
  })
})
