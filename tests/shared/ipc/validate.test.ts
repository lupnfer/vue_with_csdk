import { describe, it, expect } from 'vitest'
import { validate } from '../../../src/shared/ipc/validate'
import { versionResultSchema, pingResultSchema } from '../../../src/shared/ipc/channels'

describe('IPC 契约校验', () => {
  it('合法的版本信息通过校验', () => {
    const info = { version: '0.1.0', electron: '36.0.0', platform: 'win32' }
    expect(validate(versionResultSchema, info)).toEqual(info)
  })

  it('缺少字段被拒绝', () => {
    expect(() => validate(versionResultSchema, { version: '0.1.0' })).toThrow()
  })

  it('ping 结果必须是布尔 ok', () => {
    expect(validate(pingResultSchema, { ok: true })).toEqual({ ok: true })
    expect(() => validate(pingResultSchema, { ok: 'yes' })).toThrow()
  })
})
