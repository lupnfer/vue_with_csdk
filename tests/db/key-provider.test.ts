import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { StaticKeyProvider, SafeStorageKeyProvider, type DbKeys } from '../../src/main/db-service/key-provider'
import { DbError } from '../../src/main/db-service/errors'

describe('StaticKeyProvider', () => {
  it('返回构造时传入的密钥', async () => {
    const keys: DbKeys = { dbKey: randomBytes(32), fieldKey: randomBytes(32) }
    const p = new StaticKeyProvider(keys)
    await expect(p.loadKeys()).resolves.toEqual(keys)
  })

  it('saveKeys 是空操作（不持久化）', async () => {
    const keys: DbKeys = { dbKey: randomBytes(32), fieldKey: randomBytes(32) }
    const p = new StaticKeyProvider(keys)
    await expect(p.saveKeys(keys)).resolves.toBeUndefined()
    await expect(p.loadKeys()).resolves.toEqual(keys)
  })

  it('不传密钥时自动生成 32 字节密钥', async () => {
    const p = new StaticKeyProvider()
    const keys = await p.loadKeys()
    expect(keys.dbKey.length).toBe(32)
    expect(keys.fieldKey.length).toBe(32)
  })
})

describe('SafeStorageKeyProvider', () => {
  it('safeStorage 不可用时抛 DB_KEY_ERROR', async () => {
    // 模拟非 Electron 环境：safeStorage 为 undefined
    const p = new SafeStorageKeyProvider('/tmp/unused-keys.bin')
    await expect(p.loadKeys()).rejects.toBeInstanceOf(DbError)
    await expect(p.loadKeys()).rejects.toMatchObject({ code: 'DB_KEY_ERROR' })
  })
})
