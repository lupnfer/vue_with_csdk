import type Database from 'better-sqlite3-multiple-ciphers'
import type { KeyProvider } from './key-provider'
import { openEncryptedDb, closeDb } from './db'
import { migrate } from './migrations'
import { Repositories } from './repositories'
import { DbError } from './errors'
import type { ConfigEntry } from './types'

export class DbClient {
  private db: Database.Database | null = null
  private repos: Repositories | null = null

  constructor(
    private readonly path: string,
    private readonly keyProvider: KeyProvider
  ) {}

  async open(): Promise<void> {
    const keys = await this.keyProvider.loadKeys()
    this.db = openEncryptedDb(this.path, keys.dbKey)
    migrate(this.db)
    this.repos = new Repositories(this.db, keys.fieldKey)
  }

  private ensure(): Repositories {
    if (!this.repos) {
      throw new DbError('DB_NOT_OPEN', 'io', 'database not opened', true)
    }
    return this.repos
  }

  getAppConfig(key: string): string | null {
    return this.ensure().getAppConfig(key)
  }
  setAppConfig(key: string, value: string): void {
    this.ensure().setAppConfig(key, value)
  }
  deleteAppConfig(key: string): void {
    this.ensure().deleteAppConfig(key)
  }
  listAppConfig(): ConfigEntry[] {
    return this.ensure().listAppConfig()
  }

  getSecretConfig(key: string): string | null {
    return this.ensure().getSecretConfig(key)
  }
  setSecretConfig(key: string, value: string): void {
    this.ensure().setSecretConfig(key, value)
  }
  deleteSecretConfig(key: string): void {
    this.ensure().deleteSecretConfig(key)
  }
  listSecretConfig(): ConfigEntry[] {
    return this.ensure().listSecretConfig()
  }

  close(): void {
    if (this.db) {
      closeDb(this.db)
      this.db = null
      this.repos = null
    }
  }
}
