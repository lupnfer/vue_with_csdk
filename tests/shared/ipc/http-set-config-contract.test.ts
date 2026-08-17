import { describe, it, expect } from 'vitest'
import { validate } from '../../../src/shared/ipc/validate'
import { httpConfigSchema } from '../../../src/shared/ipc/channels'

describe('HTTP setConfig 契约', () => {
  it('合法配置通过', () => {
    const c = { baseUrl: 'http://api', refreshUrl: 'http://api/refresh' }
    expect(validate(httpConfigSchema, c)).toEqual(c)
  })

  it('带可选字段通过', () => {
    const c = { baseUrl: 'http://api', refreshUrl: 'http://api/refresh', timeoutMs: 5000, maxRetries: 2 }
    expect(validate(httpConfigSchema, c)).toEqual(c)
  })

  it('缺 refreshUrl 被拒', () => {
    expect(() => validate(httpConfigSchema, { baseUrl: 'http://api' })).toThrow()
  })

  it('timeoutMs 非正整数被拒', () => {
    expect(() => validate(httpConfigSchema, { baseUrl: 'http://api', refreshUrl: 'http://r', timeoutMs: -1 })).toThrow()
    expect(() => validate(httpConfigSchema, { baseUrl: 'http://api', refreshUrl: 'http://r', timeoutMs: 1.5 })).toThrow()
  })
})
