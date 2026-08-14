import { describe, it, expect } from 'vitest'
import { InMemoryTokenStore } from '../../src/main/http-client/token-store'
import { defaultHttpConfig, mergeConfig } from '../../src/main/http-client/config'

describe('InMemoryTokenStore', () => {
  it('读写 token + refreshToken', async () => {
    const s = new InMemoryTokenStore()
    await s.setToken('t1')
    await s.setRefreshToken('r1')
    expect(await s.getToken()).toBe('t1')
    expect(await s.getRefreshToken()).toBe('r1')
  })

  it('初始为 null', async () => {
    const s = new InMemoryTokenStore()
    expect(await s.getToken()).toBeNull()
    expect(await s.getRefreshToken()).toBeNull()
  })

  it('clear 清空', async () => {
    const s = new InMemoryTokenStore()
    await s.setToken('t1')
    await s.setRefreshToken('r1')
    await s.clear()
    expect(await s.getToken()).toBeNull()
    expect(await s.getRefreshToken()).toBeNull()
  })
})

describe('HttpConfig', () => {
  it('默认值', () => {
    const c = defaultHttpConfig()
    expect(c.timeoutMs).toBe(10000)
    expect(c.maxRetries).toBe(3)
    expect(c.baseUrl).toBe('')
    expect(c.refreshUrl).toBe('')
  })

  it('mergeConfig 覆盖默认', () => {
    const c = mergeConfig({ baseUrl: 'http://api', timeoutMs: 5000 })
    expect(c.baseUrl).toBe('http://api')
    expect(c.timeoutMs).toBe(5000)
    expect(c.maxRetries).toBe(3) // 未覆盖的保留默认
  })

  it('mergeConfig 从 JSON 字符串解析', () => {
    const c = mergeConfig(JSON.stringify({ baseUrl: 'http://x', refreshUrl: 'http://x/r' }))
    expect(c.baseUrl).toBe('http://x')
    expect(c.refreshUrl).toBe('http://x/r')
  })
})
