import { describe, it, expect } from 'vitest'
import { UseCaseError, wrapServiceError } from '../../src/main/use-cases/errors'

describe('UseCaseError', () => {
  it('wrapServiceError 包装 sdk 错误', () => {
    const cause = new Error('sdk init failed')
    const err = wrapServiceError(cause, 'sdk')
    expect(err).toBeInstanceOf(UseCaseError)
    expect(err.category).toBe('sdk')
    expect(err.cause).toBe(cause)
    expect(err.message).toContain('sdk init failed')
  })

  it('wrapServiceError 包装 db 错误', () => {
    const cause = new Error('db write failed')
    const err = wrapServiceError(cause, 'db')
    expect(err.category).toBe('db')
    expect(err.cause).toBe(cause)
  })

  it('wrapServiceError 包装 http 错误', () => {
    const cause = new Error('http upload failed')
    const err = wrapServiceError(cause, 'http')
    expect(err.category).toBe('http')
  })

  it('orchestration 错误（无 cause）', () => {
    const err = wrapServiceError(new Error('event timeout'), 'orchestration')
    expect(err.category).toBe('orchestration')
    expect(err.message).toContain('event timeout')
  })
})
