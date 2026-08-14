import { describe, it, expect } from 'vitest'
import { FakeTransport, type HttpResponse } from '../../src/main/http-client/transport'

describe('FakeTransport', () => {
  it('按队列返回响应', async () => {
    const t = new FakeTransport([
      { status: 200, headers: {}, body: 'a' },
      { status: 200, headers: {}, body: 'b' }
    ])
    const r1 = await t.send({ method: 'GET', url: 'http://x', headers: {}, timeoutMs: 1000 })
    const r2 = await t.send({ method: 'GET', url: 'http://x', headers: {}, timeoutMs: 1000 })
    expect(r1.body).toBe('a')
    expect(r2.body).toBe('b')
  })

  it('记录收到的请求供断言', async () => {
    const t = new FakeTransport([{ status: 200, headers: {}, body: '' }])
    await t.send({ method: 'POST', url: 'http://x/users', headers: { Authorization: 'Bearer t' }, body: '{"a":1}', timeoutMs: 1000 })
    expect(t.requests).toHaveLength(1)
    expect(t.requests[0].method).toBe('POST')
    expect(t.requests[0].headers.Authorization).toBe('Bearer t')
    expect(t.requests[0].body).toBe('{"a":1}')
  })

  it('可抛错误模拟网络故障', async () => {
    const t = new FakeTransport([], { throwError: new Error('ECONNREFUSED') })
    await expect(t.send({ method: 'GET', url: 'http://x', headers: {}, timeoutMs: 1000 })).rejects.toThrow('ECONNREFUSED')
  })

  it('队列耗尽抛错', async () => {
    const t = new FakeTransport([{ status: 200, headers: {}, body: 'a' }])
    await t.send({ method: 'GET', url: 'http://x', headers: {}, timeoutMs: 1000 })
    await expect(t.send({ method: 'GET', url: 'http://x', headers: {}, timeoutMs: 1000 })).rejects.toThrow(/exhausted/)
  })

  it('可注入响应函数（动态）', async () => {
    const t = new FakeTransport((req) => ({ status: 200, headers: {}, body: req.url }))
    const r = await t.send({ method: 'GET', url: 'http://x/dynamic', headers: {}, timeoutMs: 1000 })
    expect(r.body).toBe('http://x/dynamic')
  })
})
