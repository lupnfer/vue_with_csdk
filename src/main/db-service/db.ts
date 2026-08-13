import Database from 'better-sqlite3-multiple-ciphers'
import { translateDbError } from './errors'

/** 打开加密库：设密钥并验证（读 schema 页，错误密钥抛 DB_KEY_ERROR） */
export function openEncryptedDb(path: string, dbKey: Buffer): Database.Database {
  const db = new Database(path)
  db.key(dbKey)
  try {
    // 读 sqlite_master 触发解密；错误密钥 → SQLITE_NOTADB
    db.prepare('SELECT count(*) AS n FROM sqlite_master').get()
  } catch (e) {
    db.close()
    const code = (e as { code?: string }).code ?? 'UNKNOWN'
    if (code === 'SQLITE_NOTADB' || code === 'SQLITE_AUTH') {
      throw translateDbError({ code, message: 'wrong key or not a database' })
    }
    throw translateDbError({ code, message: (e as Error).message })
  }
  return db
}

export function closeDb(db: Database.Database): void {
  db.close()
}
