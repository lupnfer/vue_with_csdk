import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import Database from 'better-sqlite3-multiple-ciphers'

let dir: string
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('better-sqlite3-multiple-ciphers load', () => {
  it('能加载模块、用 key 加密、读写', () => {
    dir = mkdtempSync(join(tmpdir(), 'crc-db-load-'))
    const path = join(dir, 'test.db')
    const key = randomBytes(32)

    const db = new Database(path)
    db.key(key)
    db.exec('CREATE TABLE t (v TEXT)')
    db.prepare('INSERT INTO t VALUES (?)').run('hello')
    expect(db.prepare('SELECT v FROM t').get()).toEqual({ v: 'hello' })
    db.close()
  })
})
