import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { openEncryptedDb } from '../../src/main/db-service/db'
import { migrate, SCHEMA_VERSION } from '../../src/main/db-service/migrations'
import { DbError } from '../../src/main/db-service/errors'
import type { Database } from 'better-sqlite3-multiple-ciphers'

let dir: string
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('openEncryptedDb', () => {
  it('新库：打开 + 设密钥 + 建表后可读写', () => {
    dir = mkdtempSync(join(tmpdir(), 'crc-db-open-'))
    const db = openEncryptedDb(join(dir, 'a.db'), randomBytes(32))
    db.exec('CREATE TABLE t (v TEXT)')
    db.prepare('INSERT INTO t VALUES (?)').run('x')
    expect(db.prepare('SELECT v FROM t').get()).toEqual({ v: 'x' })
    db.close()
  })

  it('错误密钥打开已加密库抛 DB_KEY_ERROR', () => {
    dir = mkdtempSync(join(tmpdir(), 'crc-db-open-'))
    const path = join(dir, 'b.db')
    const db = openEncryptedDb(path, randomBytes(32))
    // 写入 DDL 触发加密页落盘：仅 open+读 sqlite_master 不会写入任何页（文件 0 字节），
    // 错误密钥重开时无加密内容可校验，不会抛错。必须先写入数据页才能验证密钥。
    db.exec('CREATE TABLE t (v TEXT)')
    db.close()
    expect(() => openEncryptedDb(path, randomBytes(32))).toThrow(DbError)
    expect(() => openEncryptedDb(path, randomBytes(32))).toThrow(/DB_KEY_ERROR/)
  })

  it('正确密钥能重新打开已存在的库', () => {
    dir = mkdtempSync(join(tmpdir(), 'crc-db-open-'))
    const path = join(dir, 'c.db')
    const key = randomBytes(32)
    const db1 = openEncryptedDb(path, key)
    db1.exec('CREATE TABLE t (v TEXT)')
    db1.prepare('INSERT INTO t VALUES (?)').run('persisted')
    db1.close()
    const db2 = openEncryptedDb(path, key)
    expect(db2.prepare('SELECT v FROM t').get()).toEqual({ v: 'persisted' })
    db2.close()
  })
})

describe('migrate', () => {
  it('全新库迁移后建出三表 + schema_migrations 记录', () => {
    dir = mkdtempSync(join(tmpdir(), 'crc-db-mig-'))
    const db = openEncryptedDb(join(dir, 'd.db'), randomBytes(32))
    migrate(db)
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
    expect(tables.map((t) => t.name)).toEqual(['app_config', 'schema_migrations', 'secret_config'])
    const ver = db.prepare('SELECT version FROM schema_migrations').get() as { version: number }
    expect(ver.version).toBe(SCHEMA_VERSION)
    db.close()
  })

  it('重复迁移不重复写 schema_migrations', () => {
    dir = mkdtempSync(join(tmpdir(), 'crc-db-mig-'))
    const db = openEncryptedDb(join(dir, 'e.db'), randomBytes(32))
    migrate(db)
    migrate(db)
    const count = (db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }).n
    expect(count).toBe(1)
    db.close()
  })
})
