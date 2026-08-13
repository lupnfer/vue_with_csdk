import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { DbError } from './errors'

export interface DbKeys {
  dbKey: Buffer    // 32 字节，传给 db.key()
  fieldKey: Buffer // 32 字节，AES-256-GCM 字段加密
}

export interface KeyProvider {
  loadKeys(): Promise<DbKeys>
  saveKeys(keys: DbKeys): Promise<void>
}

function randomKeys(): DbKeys {
  return { dbKey: randomBytes(32), fieldKey: randomBytes(32) }
}

/** 测试桩：固定或内存生成密钥，不碰文件系统 / safeStorage */
export class StaticKeyProvider implements KeyProvider {
  private readonly keys: DbKeys

  constructor(keys?: DbKeys) {
    this.keys = keys ?? randomKeys()
  }

  async loadKeys(): Promise<DbKeys> {
    return this.keys
  }

  async saveKeys(_keys: DbKeys): Promise<void> {
    // no-op：测试用，不持久化
  }
}

/**
 * 默认实现：用 Electron safeStorage 加密两把随机密钥，落盘 userData/db-keys.bin。
 * 仅在 Electron 运行时可用；非 Electron 环境 loadKeys 抛 DB_KEY_ERROR。
 */
export class SafeStorageKeyProvider implements KeyProvider {
  constructor(private readonly keysFile: string) {}

  async loadKeys(): Promise<DbKeys> {
    const safeStorage = this.getSafeStorage()
    if (!safeStorage) {
      throw new DbError('DB_KEY_ERROR', 'key', 'safeStorage unavailable (not in Electron runtime)', false)
    }
    try {
      const encrypted = await readFile(this.keysFile)
      const json = safeStorage.decryptString(encrypted.toString('utf8'))
      const parsed = JSON.parse(json) as { dbKey: string; fieldKey: string }
      return { dbKey: Buffer.from(parsed.dbKey, 'base64'), fieldKey: Buffer.from(parsed.fieldKey, 'base64') }
    } catch {
      // 文件不存在或解密失败：生成新密钥并持久化
      const keys = randomKeys()
      await this.saveKeys(keys)
      return keys
    }
  }

  async saveKeys(keys: DbKeys): Promise<void> {
    const safeStorage = this.getSafeStorage()
    if (!safeStorage) {
      throw new DbError('DB_KEY_ERROR', 'key', 'safeStorage unavailable (not in Electron runtime)', false)
    }
    const json = JSON.stringify({
      dbKey: keys.dbKey.toString('base64'),
      fieldKey: keys.fieldKey.toString('base64')
    })
    const encrypted = safeStorage.encryptString(json)
    await writeFile(this.keysFile, encrypted, 'utf8')
  }

  /** 懒加载 electron safeStorage；非 Electron 返回 undefined */
  private getSafeStorage(): { encryptString: (s: string) => string; decryptString: (s: string) => string } | undefined {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require('electron')
      return electron?.safeStorage
    } catch {
      return undefined
    }
  }
}
