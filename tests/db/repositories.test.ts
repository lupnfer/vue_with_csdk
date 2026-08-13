import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { openEncryptedDb } from '../../src/main/db-service/db'
import { migrate } from '../../src/main/db-service/migrations'
import { Repositories } from '../../src/main/db-service/repositories'
import type { Database } from 'better-sqlite3-multiple-ciphers'

let dir: string
let db: Database.Database
let repos: Repositories

afterEach(() => {
  db?.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

function setup(): void {
  dir = mkdtempSync(join(tmpdir(), 'crc-db-repo-'))
  const fieldKey = randomBytes(32)
  db = openEncryptedDb(join(dir, 'r.db'), randomBytes(32))
  migrate(db)
  repos = new Repositories(db, fieldKey)
}

describe('app_config', () => {
  it('set 后 get 返回原值', () => {
    setup()
    repos.setAppConfig('theme', 'dark')
    expect(repos.getAppConfig('theme')).toBe('dark')
  })

  it('upsert 更新已存在 key', () => {
    setup()
    repos.setAppConfig('theme', 'dark')
    repos.setAppConfig('theme', 'light')
    expect(repos.getAppConfig('theme')).toBe('light')
  })

  it('get 不存在的 key 返回 null', () => {
    setup()
    expect(repos.getAppConfig('nope')).toBeNull()
  })

  it('list 返回全部条目', () => {
    setup()
    repos.setAppConfig('a', '1')
    repos.setAppConfig('b', '2')
    const list = repos.listAppConfig()
    expect(list.map((e) => e.key).sort()).toEqual(['a', 'b'])
  })

  it('delete 后 get 返回 null', () => {
    setup()
    repos.setAppConfig('x', '1')
    repos.deleteAppConfig('x')
    expect(repos.getAppConfig('x')).toBeNull()
  })
})

describe('secret_config', () => {
  it('set 后 get 返回原明文（加解密往返）', () => {
    setup()
    repos.setSecretConfig('api_token', 'super-secret-token')
    expect(repos.getSecretConfig('api_token')).toBe('super-secret-token')
  })

  it('存储的是密文 BLOB（与明文不同）', () => {
    setup()
    repos.setSecretConfig('api_token', 'plain-token')
    const row = db.prepare('SELECT value FROM secret_config WHERE key=?').get('api_token') as { value: Buffer }
    expect(Buffer.isBuffer(row.value)).toBe(true)
    expect(row.value.includes(Buffer.from('plain-token'))).toBe(false)
  })

  it('list 逐条解密返回明文', () => {
    setup()
    repos.setSecretConfig('k1', 'v1')
    repos.setSecretConfig('k2', 'v2')
    const list = repos.listSecretConfig()
    const map = Object.fromEntries(list.map((e) => [e.key, e.value]))
    expect(map).toEqual({ k1: 'v1', k2: 'v2' })
  })

  it('delete 后 get 返回 null', () => {
    setup()
    repos.setSecretConfig('k', 'v')
    repos.deleteSecretConfig('k')
    expect(repos.getSecretConfig('k')).toBeNull()
  })
})
