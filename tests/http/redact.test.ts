import { describe, it, expect, vi, afterEach } from 'vitest'
import { HttpClient } from '../../src/main/http-client/http-client'
import { FakeTransport } from '../../src/main/http-client/transport'
import { InMemoryTokenStore } from '../../src/main/http-client/token-store'
import { defaultHttpConfig } from '../../src/main/http-client/config'

afterEach(() => vi.restoreAllMocks())

describe('HttpClient 脱敏', () => {
  it('错误日志不含 token 原值', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const transport = new FakeTransport([
      { status: 500, headers: {}, body: 'e' },
      { status: 500, headers: {}, body: 'e' }
    ])
    const tokens = new InMemoryTokenStore()
    await tokens.setToken('SECRET-TOKEN-VALUE')
    const http = new HttpClient(transport, tokens, { ...defaultHttpConfig(), maxRetries: 1, timeoutMs: 1000 })

    await expect(http.get('/x')).rejects.toMatchObject({ kind: 'server' })

    const logged = debugSpy.mock.calls.map((c) => String(c)).join('\n')
    expect(logged).not.toContain('SECRET-TOKEN-VALUE')
    expect(logged).not.toContain('Bearer')
  })

  it('redactHeaders 在刷新日志场景也不泄漏', async () => {
    const { redactHeaders } = await import('../../src/main/http-client/http-error')
    const r = redactHeaders({ Authorization: 'Bearer SECRET', X: 'keep' })
    expect(JSON.stringify(r)).not.toContain('SECRET')
    expect(r.X).toBe('keep')
  })
})
