import { describe, it, expect } from 'vitest'
import { validate } from '../../../src/shared/ipc/validate'
import { dbKeySchema, dbValueSchema, dbConfigEntrySchema, dbConfigListSchema } from '../../../src/shared/ipc/channels'

describe('DB IPC 契约', () => {
  it('key 必须非空字符串', () => {
    expect(validate(dbKeySchema, 'theme')).toBe('theme')
    expect(() => validate(dbKeySchema, '')).toThrow()
  })

  it('value 是字符串', () => {
    expect(validate(dbValueSchema, 'dark')).toBe('dark')
    expect(() => validate(dbValueSchema, 123)).toThrow()
  })

  it('config entry 结构校验', () => {
    const e = { key: 'theme', value: 'dark', updatedAt: '2026-08-13T00:00:00Z' }
    expect(validate(dbConfigEntrySchema, e)).toEqual(e)
    expect(() => validate(dbConfigEntrySchema, { key: 'x' })).toThrow()
  })

  it('list 是 entry 数组', () => {
    const list = [{ key: 'a', value: '1', updatedAt: 't1' }]
    expect(validate(dbConfigListSchema, list)).toEqual(list)
    expect(() => validate(dbConfigListSchema, 'not-array')).toThrow()
  })
})
