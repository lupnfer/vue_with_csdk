import { describe, it, expect } from 'vitest'
import { HttpClient } from '../../src/main/http-client/http-client'
import { FakeTransport } from '../../src/main/http-client/transport'
import { InMemoryTokenStore } from '../../src/main/http-client/token-store'
import { defaultHttpConfig } from '../../src/main/http-client/config'

describe('HttpClient 端到端', () => {
  it('GET 成功 → 401 刷新 → 重放成功', async () => {
    const cfg = { ...defaultHttpConfig(), baseUrl: 'http://api', refreshUrl: 'http://api/refresh', timeoutMs: 1000, maxRetries: 0 }
    const transport = new FakeTransport([
      { status: 200, headers: {}, body: '{"first":true}' },
      { status: 401, headers: {}, body: '' },
      { status: 200, headers: {}, body: '{"token":"t2","refreshToken":"r2"}' },
      { status: 200, headers: {}, body: '{"second":true}' }
    ])
    const tokens = new InMemoryTokenStore()
    await tokens.setToken('t1')
    await tokens.setRefreshToken('r1')
    const http = new HttpClient(transport, tokens, cfg)

    const r1 = await http.get<{ first: boolean }>('/data')
    expect(r1.body.first).toBe(true)

    const r2 = await http.get<{ second: boolean }>('/data')
    expect(r2.body.second).toBe(true)
    expect(await tokens.getToken()).toBe('t2')
  })

  it('post 带 body 正确发送', async () => {
    const transport = new FakeTransport([{ status: 201, headers: {}, body: '{"id":1}' }])
    const http = new HttpClient(transport, new InMemoryTokenStore(), { ...defaultHttpConfig(), baseUrl: 'http://api' })
    const res = await http.post<{ id: number }>('/items', { body: { name: 'x' } })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(1)
    expect(transport.requests[0].body).toBe('{"name":"x"}')
    expect(transport.requests[0].headers['Content-Type']).toBe('application/json')
  })
})
