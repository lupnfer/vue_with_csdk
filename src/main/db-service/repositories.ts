import type Database from 'better-sqlite3-multiple-ciphers'
import { encryptField, decryptField } from './field-cipher'
import type { ConfigEntry } from './types'

function now(): string {
  return new Date().toISOString()
}

export class Repositories {
  constructor(
    private readonly db: Database.Database,
    private readonly fieldKey: Buffer
  ) {}

  // ---- app_config（明文 value）----
  getAppConfig(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  setAppConfig(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(key, value, now())
  }

  deleteAppConfig(key: string): void {
    this.db.prepare('DELETE FROM app_config WHERE key = ?').run(key)
  }

  listAppConfig(): ConfigEntry[] {
    const rows = this.db.prepare('SELECT key, value, updated_at FROM app_config ORDER BY key').all() as {
      key: string
      value: string
      updated_at: string
    }[]
    return rows.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updated_at }))
  }

  // ---- secret_config（value 经 field-cipher 二次加密）----
  getSecretConfig(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM secret_config WHERE key = ?').get(key) as { value: Buffer } | undefined
    if (!row) return null
    return decryptField(row.value, this.fieldKey)
  }

  setSecretConfig(key: string, value: string): void {
    const blob = encryptField(value, this.fieldKey)
    this.db
      .prepare('INSERT INTO secret_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(key, blob, now())
  }

  deleteSecretConfig(key: string): void {
    this.db.prepare('DELETE FROM secret_config WHERE key = ?').run(key)
  }

  listSecretConfig(): ConfigEntry[] {
    const rows = this.db.prepare('SELECT key, value, updated_at FROM secret_config ORDER BY key').all() as {
      key: string
      value: Buffer
      updated_at: string
    }[]
    return rows.map((r) => ({ key: r.key, value: decryptField(r.value, this.fieldKey), updatedAt: r.updated_at }))
  }
}
