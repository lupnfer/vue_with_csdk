import { describe, it, expect } from 'vitest'
import { validate } from '../../../src/shared/ipc/validate'
import { httpPathSchema, httpOptionsSchema } from '../../../src/shared/ipc/channels'

describe('HTTP IPC 契约', () => {
  it('path 必须非空', () => {
    expect(validate(httpPathSchema, '/users')).toBe('/users')
    expect(() => validate(httpPathSchema, '')).toThrow()
  })

  it('opts 可选', () => {
    expect(validate(httpOptionsSchema, undefined)).toBeUndefined()
  })

  it('opts.headers 是字符串 record', () => {
    const opts = { headers: { Authorization: 'Bearer x' }, body: { a: 1 } }
    expect(validate(httpOptionsSchema, opts)).toEqual(opts)
  })

  it('opts.timeoutMs 必须正整数', () => {
    expect(() => validate(httpOptionsSchema, { timeoutMs: -1 })).toThrow()
    expect(() => validate(httpOptionsSchema, { timeoutMs: 1.5 })).toThrow()
  })
})
