import { describe, it, expect } from 'vitest'
import {
  crcVersion,
  crcInit,
  crcOpen,
  crcRelease,
  crcClose,
  registerCallback,
  unregisterCallback
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
    // Pattern B（与 worker 一致）：注册回调拿指针，把指针传给 open_params.cb，
    // 而非直接传 JS 函数（koffi 对后者按 transient 处理，crcOpen 返回即失效）。
    // 异步回调路径在 Task 5 验证。
    const cb = (): void => {}
    const regId = registerCallback(cb)
    const handle = crcOpen(session!, { cb: regId, user_data: null } as unknown as OpenParamsStruct)
    expect(handle).not.toBeNull()
    expect(crcRelease(handle!)).toBe(0)
    unregisterCallback(regId)
    expect(crcClose(session!)).toBe(0)
  })
})
