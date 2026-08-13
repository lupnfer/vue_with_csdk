import { describe, it, expect } from 'vitest'
import {
  crcVersion,
  crcInit,
  crcOpen,
  crcRelease,
  crcClose,
  registerCallback
} from '../../src/main/sdk-service/binding'
import type { SdkConfigStruct, OpenParamsStruct } from '../../src/main/sdk-service/binding'

describe('binding', () => {
  it('声明加载成功并读取版本', () => {
    expect(crcVersion()).toBe('crc-mock-1.0.0')
  })

  it('init 非法 config 返回 NULL 指针', () => {
    const ptr = crcInit({ mode: -1, logger: { level: 0, prefix: 'x' } } as unknown as SdkConfigStruct)
    expect(ptr).toBeNull()
  })

  it('完整生命周期：init → open → release → close', () => {
    const session = crcInit({ mode: 1, logger: { level: 2, prefix: 't' } } as unknown as SdkConfigStruct)
    expect(session).not.toBeNull()
    // 注册空回调让 open 成功（C 侧拒绝 cb=NULL）；异步回调路径在 Task 5 验证
    const cb = (): void => {}
    registerCallback(cb)
    const handle = crcOpen(session!, { cb, user_data: null } as unknown as OpenParamsStruct)
    expect(handle).not.toBeNull()
    expect(crcRelease(handle!)).toBe(0)
    expect(crcClose(session!)).toBe(0)
  })
})
