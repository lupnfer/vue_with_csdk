export type DbErrorCategory = 'key' | 'schema' | 'io' | 'unknown'

export class DbError extends Error {
  readonly code: string
  readonly category: DbErrorCategory
  readonly retryable: boolean

  constructor(code: string, category: DbErrorCategory, message: string, retryable: boolean) {
    super(message)
    this.name = 'DbError'
    this.code = code
    this.category = category
    this.retryable = retryable
  }
}

interface Rule {
  code: string
  category: DbErrorCategory
  retryable: boolean
}

const RULES: Record<string, Rule> = {
  SQLITE_NOTADB: { code: 'DB_KEY_ERROR', category: 'key', retryable: false },
  SQLITE_AUTH: { code: 'DB_KEY_ERROR', category: 'key', retryable: false },
  SQLITE_CORRUPT: { code: 'DB_CORRUPT', category: 'schema', retryable: false }
}

export interface RawSqliteError {
  code: string
  message: string
}

export function translateDbError(raw: RawSqliteError): DbError {
  const rule = RULES[raw.code] ?? { code: 'DB_UNKNOWN', category: 'unknown', retryable: true }
  return new DbError(rule.code, rule.category, `${rule.code}: ${raw.message} (sqlite=${raw.code})`, rule.retryable)
}

export interface SerializedDbError {
  code: string
  category: DbErrorCategory
  message: string
  retryable: boolean
}

export function serializeDbError(err: DbError): SerializedDbError {
  return { code: err.code, category: err.category, message: err.message, retryable: err.retryable }
}

export function deserializeDbError(data: SerializedDbError): DbError {
  return new DbError(data.code, data.category, data.message, data.retryable)
}
