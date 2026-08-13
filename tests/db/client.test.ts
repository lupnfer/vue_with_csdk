import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { DbClient } from '../../src/main/db-service/db-client'
import { StaticKeyProvider, type DbKeys } from '../../src/main/db-service/key-provider'
import { DbError } from '../../src/main/db-service/errors'

let dir: string
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('DbClient 端到端', () => {
  it('open → app_config/secret_config CRUD → close → 重开数据还在', async () => {
    dir = mkdtempSync(join(tmpdir(), 'crc-db-client-'))
    const path = join(dir, 'client.db')
    const keys: DbKeys = { dbKey: randomBytes(32), fieldKey: randomBytes(32) }

    const c1 = new DbClient(path, new StaticKeyProvider(keys))
    await c1.open()
    c1.setAppConfig('theme', 'dark')
    c1.setSecretConfig('token', 'secret-value')
    expect(c1.getAppConfig('theme')).toBe('dark')
    expect(c1.getSecretConfig('token')).toBe('secret-value')
    c1.close()

    // 重新打开（同一密钥），数据持久化
    const c2 = new DbClient(path, new StaticKeyProvider(keys))
    await c2.open()
    expect(c2.getAppConfig('theme')).toBe('dark')
    expect(c2.getSecretConfig('token')).toBe('secret-value')
    c2.close()
  })

  it('close 后调用抛 DB_NOT_OPEN', async () => {
    dir = mkdtempSync(join(tmpdir(), 'crc-db-client-'))
    const c = new DbClient(join(dir, 'x.db'), new StaticKeyProvider())
    await c.open()
    c.close()
    expect(() => c.getAppConfig('any')).toThrow(DbError)
    // getAppConfig 同步抛错；断言结构化 code（而非 message 子串）
    let thrown: unknown
    try {
      c.getAppConfig('any')
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(DbError)
    expect((thrown as DbError).code).toBe('DB_NOT_OPEN')
  })
})
