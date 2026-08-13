import { describe, it, expect } from 'vitest'
import { SdkError, translateError } from '../../src/main/sdk-service/errors'

describe('SdkError', () => {
  it('translateError 把 C 错误码翻译成类型化错误', () => {
    const err = translateError({ code: -1, category: 'call', raw: 'bad handle' })
    expect(err).toBeInstanceOf(SdkError)
    expect(err.code).toBe('SDK_CALL_FAILED')
    expect(err.category).toBe('call')
    expect(err.retryable).toBe(false)
  })

  it('重复释放有专门码值', () => {
    const err = translateError({ code: -3, category: 'memory', raw: 'double release' })
    expect(err.code).toBe('SDK_ALREADY_RELEASED')
    expect(err.retryable).toBe(false)
  })

  it('未知码值落入 unknown 且可重试', () => {
    const err = translateError({ code: -999, category: 'unknown', raw: '?' })
    expect(err.code).toBe('SDK_UNKNOWN')
    expect(err.category).toBe('unknown')
    expect(err.retryable).toBe(true)
  })
})
