import { describe, it, expect } from 'vitest'
import { validate } from '../../../src/shared/ipc/validate'
import { scanParamsSchema } from '../../../src/shared/ipc/channels'

describe('USE_CASE IPC 契约', () => {
  it('scanParams 结构校验', () => {
    const p = { sdkConfig: { mode: 1, logger: { level: 0, prefix: '' } }, uploadUrl: '/upload' }
    expect(validate(scanParamsSchema, p)).toEqual(p)
  })

  it('uploadUrl 必须非空', () => {
    expect(() => validate(scanParamsSchema, { sdkConfig: { mode: 1, logger: { level: 0, prefix: '' } }, uploadUrl: '' })).toThrow()
  })
})
