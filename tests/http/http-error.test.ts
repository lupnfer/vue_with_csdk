import { describe, it, expect } from 'vitest'
import { HttpError, translateTransportError, redactHeaders, serializeHttpError, deserializeHttpError } from '../../src/main/http-client/http-error'

describe('HttpError', () => {
  it('5xx 翻译为 server 错误且可重试', () => {
    const err = translateTransportError({ kind: 'http', status: 500, message: 'internal error' })
    expect(err).toBeInstanceOf(HttpError)
    expect(err.kind).toBe('server')
    expect(err.status).toBe(500)
    expect(err.retryable).toBe(true)
  })

  it('4xx 非 401 翻译为 business 错误不可重试', () => {
    const err = translateTransportError({ kind: 'http', status: 422, message: 'validation' })
    expect(err.kind).toBe('business')
    expect(err.retryable).toBe(false)
  })

  it('网络错误翻译为 network 可重试', () => {
    const err = translateTransportError({ kind: 'network', message: 'ECONNREFUSED' })
    expect(err.kind).toBe('network')
    expect(err.status).toBeUndefined()
    expect(err.retryable).toBe(true)
  })

  it('超时翻译为 timeout 可重试', () => {
    const err = translateTransportError({ kind: 'timeout', message: 'timed out' })
    expect(err.kind).toBe('timeout')
    expect(err.retryable).toBe(true)
  })
})

describe('redactHeaders', () => {
  it('authorization/cookie 值替换为 ***', () => {
    const redacted = redactHeaders({ Authorization: 'Bearer secret', Cookie: 'sid=x', Accept: 'json' })
    expect(redacted.Authorization).toBe('***')
    expect(redacted.Cookie).toBe('***')
    expect(redacted.Accept).toBe('json')
  })

  it('大小写不敏感', () => {
    const redacted = redactHeaders({ authorization: 'Bearer x', AUTHORIZATION: 'Bearer y' })
    expect(redacted.authorization).toBe('***')
    expect(redacted.AUTHORIZATION).toBe('***')
  })
})

describe('serialize/deserialize', () => {
  it('往返一致', () => {
    const err = new HttpError('server', 500, 'boom', true)
    const restored = deserializeHttpError(serializeHttpError(err))
    expect(restored).toBeInstanceOf(HttpError)
    expect(restored.kind).toBe('server')
    expect(restored.status).toBe(500)
    expect(restored.retryable).toBe(true)
  })
})
