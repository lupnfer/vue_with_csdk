import { describe, it, expect } from 'vitest'
import { validate } from '../../../src/shared/ipc/validate'
import { sdkConfigSchema, sdkSessionSchema, sdkHandleSchema, sdkEventSchema } from '../../../src/shared/ipc/channels'

describe('SDK IPC 契约', () => {
  it('合法 config 通过', () => {
    const cfg = { mode: 1, logger: { level: 2, prefix: 't' } }
    expect(validate(sdkConfigSchema, cfg)).toEqual(cfg)
  })

  it('config 缺 logger 被拒', () => {
    expect(() => validate(sdkConfigSchema, { mode: 1 })).toThrow()
  })

  it('session/handle 必须是正整数 id', () => {
    expect(validate(sdkSessionSchema, { id: 1 })).toEqual({ id: 1 })
    expect(() => validate(sdkSessionSchema, { id: 'x' })).toThrow()
  })

  it('事件 schema 校验 payload 为字符串', () => {
    const ev = { handleId: 1, eventType: 2, payload: '{"x":1}' }
    expect(validate(sdkEventSchema, ev)).toEqual(ev)
    expect(() => validate(sdkEventSchema, { handleId: 1, eventType: 2, payload: 123 })).toThrow()
  })
})
