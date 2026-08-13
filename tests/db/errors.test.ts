import { describe, it, expect } from 'vitest'
import { DbError, translateDbError } from '../../src/main/db-service/errors'

describe('DbError', () => {
  it('SQLITE_NOTADB 翻译为 DB_KEY_ERROR', () => {
    const err = translateDbError({ code: 'SQLITE_NOTADB', message: 'file is not a database' })
    expect(err).toBeInstanceOf(DbError)
    expect(err.code).toBe('DB_KEY_ERROR')
    expect(err.category).toBe('key')
    expect(err.retryable).toBe(false)
  })

  it('SQLITE_CORRUPT 翻译为 DB_CORRUPT', () => {
    const err = translateDbError({ code: 'SQLITE_CORRUPT', message: 'database disk image is malformed' })
    expect(err.code).toBe('DB_CORRUPT')
    expect(err.retryable).toBe(false)
  })

  it('SQLITE_AUTH 翻译为 DB_KEY_ERROR', () => {
    const err = translateDbError({ code: 'SQLITE_AUTH', message: 'authorization denied' })
    expect(err.code).toBe('DB_KEY_ERROR')
  })

  it('未知码翻译为 DB_UNKNOWN 且可重试', () => {
    const err = translateDbError({ code: 'SQLITE_BUSY', message: 'busy' })
    expect(err.code).toBe('DB_UNKNOWN')
    expect(err.retryable).toBe(true)
  })
})
