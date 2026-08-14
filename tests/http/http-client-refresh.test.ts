import { describe, it, expect } from 'vitest'
import { HttpClient } from '../../src/main/http-client/http-client'
import { FakeTransport } from '../../src/main/http-client/transport'
import { InMemoryTokenStore } from '../../src/main/http-client/token-store'
import { defaultHttpConfig } from '../../src/main/http-client/config'

const cfg = { ...defaultHttpConfig(), baseUrl: 'http://api', refreshUrl: 'http://api/refresh', timeoutMs: 1000, maxRetries: 0 }

describe('HttpClient 401 刷新重放', () => {
  it('401 触发刷新并重放成功', async () => {
    const transport = new FakeTransport([
      { status: 401, headers: {}, body: '' },                                    // 首次请求 401
      { status: 200, headers: {}, body: '{"token":"new-t","refreshToken":"new-r"}' }, // 刷新成功
      { status: 200, headers: {}, body: '{"ok":true}' }                          // 重放成功
    ])
    const tokens = new InMemoryTokenStore()
    await tokens.setToken('old-t')
    await tokens.setRefreshToken('old-r')
    const http = new HttpClient(transport, tokens, cfg)

    const res = await http.get<{ ok: boolean }>('/data')
    expect(res.body.ok).toBe(true)
    // 刷新后 token 写回
    expect(await tokens.getToken()).toBe('new-t')
    expect(await tokens.getRefreshToken()).toBe('new-r')
    // 重放请求带了新 token
    expect(transport.requests[2].headers.Authorization).toBe('Bearer new-t')
  })

  it('无 refreshToken 抛 auth 错误', async () => {
    const transport = new FakeTransport([{ status: 401, headers: {}, body: '' }])
    const tokens = new InMemoryTokenStore()
    await tokens.setToken('old-t') // 无 refreshToken
    const http = new HttpClient(transport, tokens, cfg)
    await expect(http.get('/x')).rejects.toMatchObject({ kind: 'auth' })
  })

  it('刷新接口失败抛 auth 错误', async () => {
    const transport = new FakeTransport([
      { status: 401, headers: {}, body: '' },
      { status: 401, headers: {}, body: '' } // 刷新也 401
    ])
    const tokens = new InMemoryTokenStore()
    await tokens.setToken('t')
    await tokens.setRefreshToken('r')
    const http = new HttpClient(transport, tokens, cfg)
    await expect(http.get('/x')).rejects.toMatchObject({ kind: 'auth' })
  })

  it('并发 401 只发一次刷新（single-flight）', async () => {
    const transport = new FakeTransport([
      { status: 401, headers: {}, body: '' },
      { status: 401, headers: {}, body: '' },
      { status: 200, headers: {}, body: '{"token":"nt","refreshToken":"nr"}' }, // 只一次刷新
      { status: 200, headers: {}, body: '{"a":1}' }, // 重放 1
      { status: 200, headers: {}, body: '{"a":2}' }  // 重放 2
    ])
    const tokens = new InMemoryTokenStore()
    await tokens.setToken('t')
    await tokens.setRefreshToken('r')
    const http = new HttpClient(transport, tokens, cfg)

    const [r1, r2] = await Promise.all([http.get('/x1'), http.get('/x2')])
    expect(r1.body).toEqual({ a: 1 })
    expect(r2.body).toEqual({ a: 2 })
    // 只发了 1 次刷新请求（index 2 是唯一的状态 200 refresh 响应）
    const refreshRequests = transport.requests.filter((r) => r.url.endsWith('/refresh'))
    expect(refreshRequests).toHaveLength(1)
  })

  it('重放遇 5xx 交回外层重试（401→刷新→500→重试→成功）', async () => {
    // cfg 默认 maxRetries=0 不够用，这里用 maxRetries=1 让外层能重试一次
    const cfg2 = { ...defaultHttpConfig(), baseUrl: 'http://api', refreshUrl: 'http://api/refresh', timeoutMs: 1000, maxRetries: 1 }
    const transport = new FakeTransport([
      { status: 401, headers: {}, body: '' },                                    // 首次 401
      { status: 200, headers: {}, body: '{"token":"nt","refreshToken":"nr"}' }, // 刷新成功
      { status: 500, headers: {}, body: 'server err' },                          // 重放遇 5xx（应交回外层重试）
      { status: 200, headers: {}, body: '{"ok":true}' }                          // 重试成功
    ])
    const tokens = new InMemoryTokenStore()
    await tokens.setToken('t')
    await tokens.setRefreshToken('r')
    const http = new HttpClient(transport, tokens, cfg2)

    const res = await http.get<{ ok: boolean }>('/x')
    expect(res.body.ok).toBe(true)
    // 4 次请求：原 401 + 刷新 + 重放 500 + 重试 200
    expect(transport.requests).toHaveLength(4)
  })
})
