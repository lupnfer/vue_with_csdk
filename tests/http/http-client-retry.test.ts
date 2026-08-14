import { describe, it, expect } from 'vitest'
import { HttpClient } from '../../src/main/http-client/http-client'
import { FakeTransport } from '../../src/main/http-client/transport'
import { InMemoryTokenStore } from '../../src/main/http-client/token-store'
import { defaultHttpConfig } from '../../src/main/http-client/config'
import { HttpError } from '../../src/main/http-client/http-error'

function client(responses: Parameters<typeof FakeTransport>[0], config = defaultHttpConfig()): { http: HttpClient; transport: FakeTransport } {
  const transport = new FakeTransport(responses)
  const http = new HttpClient(transport, new InMemoryTokenStore(), { ...config, timeoutMs: 1000 })
  return { http, transport }
}

describe('HttpClient 基础请求', () => {
  it('get 返回解析后的 JSON body', async () => {
    const { http } = client([{ status: 200, headers: {}, body: '{"x":1}' }])
    const res = await http.get<{ x: number }>('/users')
    expect(res.status).toBe(200)
    expect(res.body.x).toBe(1)
  })

  it('注入 Authorization 头', async () => {
    const { http, transport } = client([{ status: 200, headers: {}, body: '{}' }])
    await http.tokens.setToken('my-token')
    await http.get('/x')
    expect(transport.requests[0].headers.Authorization).toBe('Bearer my-token')
  })

  it('拼 baseUrl + path', async () => {
    const { http, transport } = client([{ status: 200, headers: {}, body: '{}' }], { ...defaultHttpConfig(), baseUrl: 'http://api' })
    await http.get('/users')
    expect(transport.requests[0].url).toBe('http://api/users')
  })
})

describe('HttpClient 重试', () => {
  it('GET 遇 500 重试到成功', async () => {
    const { http, transport } = client([
      { status: 500, headers: {}, body: 'err' },
      { status: 200, headers: {}, body: '{"ok":true}' }
    ])
    const res = await http.get<{ ok: boolean }>('/x')
    expect(res.body.ok).toBe(true)
    expect(transport.requests).toHaveLength(2)
  })

  it('GET 重试耗尽抛 server 错误', async () => {
    const { http } = client([
      { status: 500, headers: {}, body: 'e' },
      { status: 500, headers: {}, body: 'e' },
      { status: 500, headers: {}, body: 'e' },
      { status: 500, headers: {}, body: 'e' }
    ])
    await expect(http.get('/x')).rejects.toMatchObject({ kind: 'server', status: 500 })
  })

  it('POST 遇 500 不重试直接抛', async () => {
    const { http, transport } = client([{ status: 500, headers: {}, body: 'e' }])
    await expect(http.post('/x', { body: { a: 1 } })).rejects.toMatchObject({ kind: 'server' })
    expect(transport.requests).toHaveLength(1)
  })

  it('4xx 非 401 不重试抛 business', async () => {
    const { http, transport } = client([{ status: 422, headers: {}, body: 'bad' }])
    await expect(http.get('/x')).rejects.toMatchObject({ kind: 'business', status: 422 })
    expect(transport.requests).toHaveLength(1)
  })
})
