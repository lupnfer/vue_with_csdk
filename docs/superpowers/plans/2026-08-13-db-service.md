# db-service 实施计划（子计划 3/6）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立加密配置库完整骨架——SQLCipher 加密库打开、可插拔 KeyProvider、3 表 schema 与迁移、app_config/secret_config CRUD（含字段级二次加密）、类型化错误，经 IPC 暴露到渲染进程可验证。

**Architecture:** better-sqlite3-multiple-ciphers（同步 API，主进程直跑，不进 worker）。KeyProvider 抽象返回 `DbKeys { dbKey, fieldKey }`：dbKey 经 `db.key(Buffer)` 打开加密库，fieldKey 经 AES-256-GCM 对 secret_config.value 二次加密。DbClient facade 主进程单例，对外只暴露业务方法（明文 string），不暴露 SQL/Buffer。

**Tech Stack:** better-sqlite3-multiple-ciphers 13.x、Node `crypto`（AES-256-GCM）、Electron `safeStorage`（默认 KeyProvider，运行时）、zod（IPC 契约）、Vitest（单测+集成，Node ABI）。

## Global Constraints

- better-sqlite3-multiple-ciphers 13.0.3 API：`import Database from 'better-sqlite3-multiple-ciphers'`；`new Database(path)`；`db.key(Buffer)` 设密钥；`db.prepare/run/get/all/exec/transaction/pragma/close`。
- **native ABI：3/6 保持 Node ABI**（vitest 可加载）。不装 `@electron/rebuild`，不跑 Electron 手动冲烟（留 6/6）。better-sqlite3-multiple-ciphers 装入 `dependencies`。
- **默认 cipher 为 sqleet（AES-256）**。POC 自建自读，不需 SQLCipher 跨工具格式兼容；若将来需要，加 `db.pragma('cipher=sqlcipher')` 及 page_size 等。这是对 spec §4.4 "Pragma key" 的细化——用 `db.key(Buffer)` 而非 hex 字符串 pragma。
- TypeScript `strict: true`；IPC 契约只定义在 `src/shared/`。
- db 测试放 `tests/db/**`，默认纳入 `npm test`（不需构建产物，纯 Node ABI，jsdom 环境不影响 Node 原生模块加载）。
- 测试用 `StaticKeyProvider`（固定密钥）+ 真实加密库 + 临时文件；每用例唯一临时路径，`afterEach` 删库。
- 提交信息用 Conventional Commits。

---

## 文件结构（本子计划创建/修改）

- `src/main/db-service/errors.ts` — DbError + translateDbError + serialize/deserialize
- `src/main/db-service/types.ts` — ConfigEntry 等对外类型
- `src/main/db-service/field-cipher.ts` — AES-256-GCM 加解密
- `src/main/db-service/key-provider.ts` — KeyProvider 接口 + DbKeys + SafeStorageKeyProvider + StaticKeyProvider
- `src/main/db-service/db.ts` — openEncryptedDb / closeDb
- `src/main/db-service/migrations.ts` — migrate（建三表）
- `src/main/db-service/repositories.ts` — app_config + secret_config CRUD
- `src/main/db-service/db-client.ts` — DbClient facade
- `src/shared/ipc/channels.ts`（修改）— DB_CHANNELS + zod schema
- `src/shared/ipc/api.ts`（修改）— RendererApi.db
- `src/main/ipc/register.ts`（修改）— db handler
- `src/preload/index.ts`（修改）— window.api.db
- `src/renderer/src/views/DbView.vue` + `router.ts`（修改）— 验证页
- `src/renderer/src/views/HomeView.vue`（修改）— 入口链接
- `tests/db/*.test.ts` — 单测 + 集成
- `package.json` — 加 better-sqlite3-multiple-ciphers

---

### Task 1: 依赖安装与 load 冒烟

**Files:**
- Modify: `package.json`（加 better-sqlite3-multiple-ciphers）
- Create: `tests/db/load.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: better-sqlite3-multiple-ciphers 在 vitest（Node ABI）下可加载、`db.key()` 可加密。

- [ ] **Step 1: 安装依赖**

```bash
npm install better-sqlite3-multiple-ciphers
```

预期：`dependencies` 出现 `better-sqlite3-multiple-ciphers`，生成 `package-lock.json`。npm 会编译 native 模块（Node ABI）。

- [ ] **Step 2: 写 load 冒烟测试**

`tests/db/load.test.ts`：

```ts
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
```

- [ ] **Step 3: 运行测试**

```bash
npx vitest run tests/db/load.test.ts
```

预期：PASS。若 native 模块加载失败（ABI 问题），报错并排查——这是 §11 #2 风险点。

- [ ] **Step 4: 验证基线**

```bash
npm run typecheck
npm test
```

预期：typecheck 通过；`npm test` 含新 load 用例全绿（sdk 集成测试需已构建 worker，若失败仅因缺 `npm run build`，记为已知 Task 10 配置项，不算回归）。

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tests/db/load.test.ts
git commit -m "feat(db): 安装 better-sqlite3-multiple-ciphers 与 load 冒烟"
```

末尾空行加 `Co-Authored-By: Claude <noreply@anthropic.com>`

---

### Task 2: errors.ts 与 types.ts（纯 TS，TDD）

**Files:**
- Create: `src/main/db-service/errors.ts`, `src/main/db-service/types.ts`
- Create: `tests/db/errors.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/db/errors.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { DbError, translateDbError } from '../../src/main/db-service/errors'

describe('DbError', () => {
  it('SQLITE_NOTADB 翻译为 DB_KEY_ERROR', () => {
    const err = translateDbError({ code: 'SQLITE_NOTADB', message: 'file is not a database' })
    expect(err).toBeInstanceOf(DbError)
    expect(err.code).toBe('DB_KEY_ERROR')
    expect(err.category).toBe('key')
    expect(err.retryable).toBe(false)
  })

  it('SQLITE_CORRUPT 翻译为 DB_CORRUPT', () => {
    const err = translateDbError({ code: 'SQLITE_CORRUPT', message: 'database disk image is malformed' })
    expect(err.code).toBe('DB_CORRUPT')
    expect(err.retryable).toBe(false)
  })

  it('SQLITE_AUTH 翻译为 DB_KEY_ERROR', () => {
    const err = translateDbError({ code: 'SQLITE_AUTH', message: 'authorization denied' })
    expect(err.code).toBe('DB_KEY_ERROR')
  })

  it('未知码翻译为 DB_UNKNOWN 且可重试', () => {
    const err = translateDbError({ code: 'SQLITE_BUSY', message: 'busy' })
    expect(err.code).toBe('DB_UNKNOWN')
    expect(err.retryable).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/db/errors.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 errors.ts**

`src/main/db-service/errors.ts`：

```ts
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
```

- [ ] **Step 4: 实现 types.ts**

`src/main/db-service/types.ts`：

```ts
/** 对外配置条目（无 SQL 细节，value 始终是明文 string） */
export interface ConfigEntry {
  key: string
  value: string
  updatedAt: string
}
```

- [ ] **Step 5: 运行确认通过**

```bash
npx vitest run tests/db/errors.test.ts
```

预期：PASS。

- [ ] **Step 6: Commit**

```bash
git add src/main/db-service/errors.ts src/main/db-service/types.ts tests/db/errors.test.ts
git commit -m "feat(db): DbError 翻译与对外类型"
```

末尾加 Co-Authored-By trailer。

---

### Task 3: field-cipher.ts（TDD）

**Files:**
- Create: `src/main/db-service/field-cipher.ts`
- Create: `tests/db/field-cipher.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/db/field-cipher.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encryptField, decryptField } from '../../src/main/db-service/field-cipher'

describe('field-cipher', () => {
  it('加密后解密往返一致', () => {
    const key = randomBytes(32)
    const blob = encryptField('hello secret', key)
    expect(decryptField(blob, key)).toBe('hello secret')
  })

  it('密文是 Buffer 且与明文不同', () => {
    const key = randomBytes(32)
    const blob = encryptField('plain', key)
    expect(Buffer.isBuffer(blob)).toBe(true)
    expect(blob.includes(Buffer.from('plain'))).toBe(false)
  })

  it('错误密钥解密失败（GCM tag 校验）', () => {
    const blob = encryptField('secret', randomBytes(32))
    expect(() => decryptField(blob, randomBytes(32))).toThrow()
  })

  it('空字符串能处理', () => {
    const key = randomBytes(32)
    const blob = encryptField('', key)
    expect(decryptField(blob, key)).toBe('')
  })

  it('两次加密同一明文产生不同密文（随机 iv）', () => {
    const key = randomBytes(32)
    const a = encryptField('same', key)
    const b = encryptField('same', key)
    expect(a.equals(b)).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/db/field-cipher.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 field-cipher.ts**

`src/main/db-service/field-cipher.ts`：

```ts
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const IV_LEN = 12
const TAG_LEN = 16

/** 加密：返回 iv(12) + tag(16) + ciphertext 的连续 Buffer */
export function encryptField(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext])
}

/** 解密：从 iv(12) + tag(16) + ciphertext 还原明文 */
export function decryptField(blob: Buffer, key: Buffer): string {
  const iv = blob.subarray(0, IV_LEN)
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ciphertext = blob.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run tests/db/field-cipher.test.ts
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main/db-service/field-cipher.ts tests/db/field-cipher.test.ts
git commit -m "feat(db): AES-256-GCM 字段级加解密"
```

---

### Task 4: key-provider.ts（TDD）

**Files:**
- Create: `src/main/db-service/key-provider.ts`
- Create: `tests/db/key-provider.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/db/key-provider.test.ts`：

```ts
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
```

> 说明：SafeStorageKeyProvider 在 vitest（非 Electron）下 `safeStorage` 不可用，`loadKeys` 应抛 `DB_KEY_ERROR`。这条测试验证降级路径；真实 safeStorage 集成推迟 6/6。

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/db/key-provider.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 key-provider.ts**

`src/main/db-service/key-provider.ts`：

```ts
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
```

> `getSafeStorage` 用 `require('electron')` 动态取，非 Electron 环境返回 undefined。`require` 在 ESM+Bundler 下用 `createRequire` 更稳，但 POC 用动态 require 即可（electron-vite 编译后是 CJS）。

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run tests/db/key-provider.test.ts
```

预期：PASS。StaticKeyProvider 三条 + SafeStorageKeyProvider 降级一条。

- [ ] **Step 5: Commit**

```bash
git add src/main/db-service/key-provider.ts tests/db/key-provider.test.ts
git commit -m "feat(db): 可插拔 KeyProvider（SafeStorage + Static 测试桩）"
```

---

### Task 5: db.ts 与 migrations.ts（TDD）

**Files:**
- Create: `src/main/db-service/db.ts`, `src/main/db-service/migrations.ts`
- Create: `tests/db/open-migrate.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/db/open-migrate.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/db/open-migrate.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 db.ts**

`src/main/db-service/db.ts`：

```ts
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
```

- [ ] **Step 4: 实现 migrations.ts**

`src/main/db-service/migrations.ts`：

```ts
import type Database from 'better-sqlite3-multiple-ciphers'

export const SCHEMA_VERSION = 1

interface Migration {
  version: number
  sql: string
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS app_config (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS secret_config (
        key   TEXT PRIMARY KEY,
        value BLOB NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  }
]

export function migrate(db: Database.Database): void {
  // schema_migrations 必须先建（全新库无任何表）
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)
  const applied = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]
  const appliedSet = new Set(applied.map((r) => r.version))

  for (const m of MIGRATIONS) {
    if (appliedSet.has(m.version)) continue
    const tx = db.transaction(() => {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        m.version,
        new Date().toISOString()
      )
    })
    tx()
  }
}
```

- [ ] **Step 5: 运行确认通过**

```bash
npx vitest run tests/db/open-migrate.test.ts
```

预期：PASS。

- [ ] **Step 6: Commit**

```bash
git add src/main/db-service/db.ts src/main/db-service/migrations.ts tests/db/open-migrate.test.ts
git commit -m "feat(db): 加密库打开与 schema 迁移"
```

---

### Task 6: repositories.ts（TDD）

**Files:**
- Create: `src/main/db-service/repositories.ts`
- Create: `tests/db/repositories.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/db/repositories.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/db/repositories.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 repositories.ts**

`src/main/db-service/repositories.ts`：

```ts
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
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run tests/db/repositories.test.ts
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main/db-service/repositories.ts tests/db/repositories.test.ts
git commit -m "feat(db): app_config/secret_config CRUD（含字段加密）"
```

---

### Task 7: db-client.ts facade（集成测试）

**Files:**
- Create: `src/main/db-service/db-client.ts`
- Create: `tests/db/client.test.ts`

- [ ] **Step 1: 实现 db-client.ts**

`src/main/db-service/db-client.ts`：

```ts
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
```

- [ ] **Step 2: 写集成测试**

`tests/db/client.test.ts`：

```ts
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
```

- [ ] **Step 3: 运行确认通过**

```bash
npx vitest run tests/db/client.test.ts
```

预期：PASS。

- [ ] **Step 4: 验证基线**

```bash
npm run typecheck
npm test
```

预期：typecheck 通过；`npm test` 含全部 db 单测/集成全绿。

- [ ] **Step 5: Commit**

```bash
git add src/main/db-service/db-client.ts tests/db/client.test.ts
git commit -m "feat(db): DbClient facade（open/CRUD/close）"
```

---

### Task 8: IPC 契约扩展（shared）

**Files:**
- Modify: `src/shared/ipc/channels.ts`, `src/shared/ipc/api.ts`
- Create: `tests/shared/ipc/db-contract.test.ts`

- [ ] **Step 1: 扩展 channels.ts**

在 `src/shared/ipc/channels.ts` 末尾追加：

```ts
// ---- DB ----
export const DB_CHANNELS = {
  getAppConfig: 'db:get-app-config',
  setAppConfig: 'db:set-app-config',
  deleteAppConfig: 'db:delete-app-config',
  listAppConfig: 'db:list-app-config',
  getSecretConfig: 'db:get-secret-config',
  setSecretConfig: 'db:set-secret-config',
  deleteSecretConfig: 'db:delete-secret-config',
  listSecretConfig: 'db:list-secret-config'
} as const

export type DbChannelName = (typeof DB_CHANNELS)[keyof typeof DB_CHANNELS]

export const dbKeySchema = z.string().min(1)
export const dbValueSchema = z.string()
export const dbConfigEntrySchema = z.object({
  key: z.string(),
  value: z.string(),
  updatedAt: z.string()
})
export const dbConfigListSchema = z.array(dbConfigEntrySchema)
```

- [ ] **Step 2: 扩展 api.ts**

在 `src/shared/ipc/api.ts` 的 `RendererApi` 之前加 `DbApi`，并在 `RendererApi` 加 `db: DbApi`：

```ts
export interface DbApi {
  getAppConfig(key: string): Promise<string | null>
  setAppConfig(key: string, value: string): Promise<void>
  deleteAppConfig(key: string): Promise<void>
  listAppConfig(): Promise<{ key: string; value: string; updatedAt: string }[]>
  getSecretConfig(key: string): Promise<string | null>
  setSecretConfig(key: string, value: string): Promise<void>
  deleteSecretConfig(key: string): Promise<void>
  listSecretConfig(): Promise<{ key: string; value: string; updatedAt: string }[]>
}

export interface RendererApi {
  ping(): Promise<{ ok: boolean }>
  getVersion(): Promise<VersionInfo>
  sdk: SdkApi
  db: DbApi
}
```

> `DbApi` 的条目类型内联为 `{ key, value, updatedAt }`，与 `dbConfigEntrySchema` 结构一致。

- [ ] **Step 3: 写契约单测**

`tests/shared/ipc/db-contract.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { validate } from '../../../src/shared/ipc/validate'
import { dbKeySchema, dbValueSchema, dbConfigEntrySchema, dbConfigListSchema } from '../../../src/shared/ipc/channels'

describe('DB IPC 契约', () => {
  it('key 必须非空字符串', () => {
    expect(validate(dbKeySchema, 'theme')).toBe('theme')
    expect(() => validate(dbKeySchema, '')).toThrow()
  })

  it('value 是字符串', () => {
    expect(validate(dbValueSchema, 'dark')).toBe('dark')
    expect(() => validate(dbValueSchema, 123)).toThrow()
  })

  it('config entry 结构校验', () => {
    const e = { key: 'theme', value: 'dark', updatedAt: '2026-08-13T00:00:00Z' }
    expect(validate(dbConfigEntrySchema, e)).toEqual(e)
    expect(() => validate(dbConfigEntrySchema, { key: 'x' })).toThrow()
  })

  it('list 是 entry 数组', () => {
    const list = [{ key: 'a', value: '1', updatedAt: 't1' }]
    expect(validate(dbConfigListSchema, list)).toEqual(list)
    expect(() => validate(dbConfigListSchema, 'not-array')).toThrow()
  })
})
```

- [ ] **Step 4: 运行单测**

```bash
npx vitest run tests/shared/ipc/db-contract.test.ts
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc/channels.ts src/shared/ipc/api.ts tests/shared/ipc/db-contract.test.ts
git commit -m "feat(db): IPC 契约扩展（db 通道与 zod schema）"
```

> 注意：本 Task 修改 `RendererApi`（加 `db` 字段），会导致 `src/preload/index.ts`（未加 db）typecheck 报错——EXPECTED，Task 9 修复。若 typecheck 仅在 preload 报 `Property 'db' is missing`，记为已知，不在本 Task 修。

---

### Task 9: 主进程 handler、preload 与渲染验证页

**Files:**
- Modify: `src/main/ipc/register.ts`, `src/preload/index.ts`, `src/renderer/src/router.ts`
- Create: `src/renderer/src/views/DbView.vue`
- Create: `tests/renderer/db-view.test.ts`

- [ ] **Step 1: 修改 register.ts 接入 DbClient**

在 `src/main/ipc/register.ts` 顶部 import 加：

```ts
import { join } from 'node:path'
import { DB_CHANNELS, dbKeySchema, dbValueSchema } from '@shared/ipc/channels'
import { DbClient } from '../db-service/db-client'
import { SafeStorageKeyProvider } from '../db-service/key-provider'
import { serializeDbError } from '../db-service/errors'
```

在 `ensureClient` 之后、`registerIpc` 之前加 DbClient 单例：

```ts
let dbClient: DbClient | null = null
let dbClientPromise: Promise<DbClient> | null = null

function ensureDbClient(): Promise<DbClient> {
  if (!dbClientPromise) {
    dbClientPromise = (async () => {
      const userData = app.getPath('userData')
      const c = new DbClient(join(userData, 'client.db'), new SafeStorageKeyProvider(join(userData, 'db-keys.bin')))
      await c.open()
      dbClient = c
      return c
    })()
  }
  return dbClientPromise
}
```

在 `registerIpc` 内（sdk handler 之后）加 db handler：

```ts
  const wrap = <T>(fn: () => T): T => {
    try {
      return fn()
    } catch (e) {
      throw e instanceof DbError ? serializeDbError(e) : e
    }
  }

  ipcMain.handle(DB_CHANNELS.getAppConfig, async (_e, key) => {
    const c = await ensureDbClient()
    return wrap(() => c.getAppConfig(validate(dbKeySchema, key)))
  })
  ipcMain.handle(DB_CHANNELS.setAppConfig, async (_e, key, value) => {
    const c = await ensureDbClient()
    wrap(() => c.setAppConfig(validate(dbKeySchema, key), validate(dbValueSchema, value)))
  })
  ipcMain.handle(DB_CHANNELS.deleteAppConfig, async (_e, key) => {
    const c = await ensureDbClient()
    wrap(() => c.deleteAppConfig(validate(dbKeySchema, key)))
  })
  ipcMain.handle(DB_CHANNELS.listAppConfig, async () => {
    const c = await ensureDbClient()
    return wrap(() => c.listAppConfig())
  })
  ipcMain.handle(DB_CHANNELS.getSecretConfig, async (_e, key) => {
    const c = await ensureDbClient()
    return wrap(() => c.getSecretConfig(validate(dbKeySchema, key)))
  })
  ipcMain.handle(DB_CHANNELS.setSecretConfig, async (_e, key, value) => {
    const c = await ensureDbClient()
    wrap(() => c.setSecretConfig(validate(dbKeySchema, key), validate(dbValueSchema, value)))
  })
  ipcMain.handle(DB_CHANNELS.deleteSecretConfig, async (_e, key) => {
    const c = await ensureDbClient()
    wrap(() => c.deleteSecretConfig(validate(dbKeySchema, key)))
  })
  ipcMain.handle(DB_CHANNELS.listSecretConfig, async () => {
    const c = await ensureDbClient()
    return wrap(() => c.listSecretConfig())
  })
```

并在顶部 import 加 `DbError`：

```ts
import { DbError } from '../db-service/errors'
```

> `wrap` 捕获 DbClient 抛的 DbError，序列化成 `SerializedDbError`（纯数据，跨 IPC）。注意 SafeStorageKeyProvider 在 vitest 非 Electron 下不可用——所以 register.ts 不写单测（同 sdk-service register.ts），靠 DbClient 层（StaticKeyProvider）已测 + typecheck。

- [ ] **Step 2: 修改 preload 暴露 window.api.db**

在 `src/preload/index.ts` 的 `api` 对象里 `sdk` 之后加 `db`：

```ts
  db: {
    getAppConfig: (key) => ipcRenderer.invoke(DB_CHANNELS.getAppConfig, key),
    setAppConfig: (key, value) => ipcRenderer.invoke(DB_CHANNELS.setAppConfig, key, value),
    deleteAppConfig: (key) => ipcRenderer.invoke(DB_CHANNELS.deleteAppConfig, key),
    listAppConfig: () => ipcRenderer.invoke(DB_CHANNELS.listAppConfig),
    getSecretConfig: (key) => ipcRenderer.invoke(DB_CHANNELS.getSecretConfig, key),
    setSecretConfig: (key, value) => ipcRenderer.invoke(DB_CHANNELS.setSecretConfig, key, value),
    deleteSecretConfig: (key) => ipcRenderer.invoke(DB_CHANNELS.deleteSecretConfig, key),
    listSecretConfig: () => ipcRenderer.invoke(DB_CHANNELS.listSecretConfig)
  }
```

并在顶部 import 加 `DB_CHANNELS`：

```ts
import { CHANNELS, SDK_CHANNELS, DB_CHANNELS } from '@shared/ipc/channels'
```

- [ ] **Step 3: 创建 DbView.vue**

`src/renderer/src/views/DbView.vue`：

```vue
<script setup lang="ts">
import { ref } from 'vue'

const appKey = ref('theme')
const appValue = ref('')
const appResult = ref('')

const secretKey = ref('api_token')
const secretValue = ref('')
const secretResult = ref('')

const error = ref('')

async function setApp(): Promise<void> {
  error.value = ''
  try {
    await window.api.db.setAppConfig(appKey.value, appValue.value)
    appResult.value = '已保存'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function getApp(): Promise<void> {
  error.value = ''
  try {
    const v = await window.api.db.getAppConfig(appKey.value)
    appResult.value = v ?? '(空)'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function setSecret(): Promise<void> {
  error.value = ''
  try {
    await window.api.db.setSecretConfig(secretKey.value, secretValue.value)
    secretResult.value = '已保存（加密）'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function getSecret(): Promise<void> {
  error.value = ''
  try {
    const v = await window.api.db.getSecretConfig(secretKey.value)
    secretResult.value = v ?? '(空)'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <main>
    <h1>DB POC</h1>
    <p v-if="error" style="color: red">{{ error }}</p>

    <section>
      <h2>app_config（明文）</h2>
      <input v-model="appKey" placeholder="key" />
      <input v-model="appValue" placeholder="value" />
      <button @click="setApp">保存</button>
      <button @click="getApp">读取</button>
      <p>结果：{{ appResult }}</p>
    </section>

    <section>
      <h2>secret_config（字段加密）</h2>
      <input v-model="secretKey" placeholder="key" />
      <input v-model="secretValue" placeholder="value" />
      <button @click="setSecret">保存</button>
      <button @click="getSecret">读取</button>
      <p>结果：{{ secretResult }}</p>
    </section>
  </main>
</template>
```

- [ ] **Step 4: 加路由**

修改 `src/renderer/src/router.ts` 的 routes 加：

```ts
import DbView from './views/DbView.vue'
// ...
    { path: '/db', component: DbView }
```

完整 `router.ts`：

```ts
import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import SdkView from './views/SdkView.vue'
import DbView from './views/DbView.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/sdk', component: SdkView },
    { path: '/db', component: DbView }
  ]
})
```

- [ ] **Step 5: 写 DbView 组件单测**

`tests/renderer/db-view.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import DbView from '../../src/renderer/src/views/DbView.vue'
import type { RendererApi } from '../../src/shared/ipc/api'

beforeEach(() => {
  window.api = {
    ping: vi.fn(),
    getVersion: vi.fn(),
    sdk: { init: vi.fn(), open: vi.fn(), startScan: vi.fn(), dispose: vi.fn(), disposeSession: vi.fn(), on: vi.fn() },
    db: {
      getAppConfig: vi.fn().mockResolvedValue('dark'),
      setAppConfig: vi.fn().mockResolvedValue(undefined),
      deleteAppConfig: vi.fn().mockResolvedValue(undefined),
      listAppConfig: vi.fn().mockResolvedValue([]),
      getSecretConfig: vi.fn().mockResolvedValue('secret-val'),
      setSecretConfig: vi.fn().mockResolvedValue(undefined),
      deleteSecretConfig: vi.fn().mockResolvedValue(undefined),
      listSecretConfig: vi.fn().mockResolvedValue([])
    }
  } as unknown as RendererApi
})

describe('DbView', () => {
  it('保存并读取 app_config', async () => {
    const wrapper = mount(DbView, { global: { stubs: { RouterLink: true } } })
    const inputs = wrapper.findAll('input')
    inputs[0].setValue('theme')   // appKey
    inputs[1].setValue('dark')    // appValue
    await wrapper.findAll('button')[0].trigger('click')  // 保存
    await wrapper.findAll('button')[1].trigger('click')  // 读取
    await new Promise((r) => setTimeout(r, 10))
    expect(window.api.db.setAppConfig).toHaveBeenCalledWith('theme', 'dark')
    expect(window.api.db.getAppConfig).toHaveBeenCalledWith('theme')
    expect(wrapper.text()).toContain('dark')
  })

  it('保存并读取 secret_config', async () => {
    const wrapper = mount(DbView, { global: { stubs: { RouterLink: true } } })
    const inputs = wrapper.findAll('input')
    inputs[2].setValue('api_token')  // secretKey
    inputs[3].setValue('secret-val') // secretValue
    await wrapper.findAll('button')[2].trigger('click')  // 保存
    await wrapper.findAll('button')[3].trigger('click')  // 读取
    await new Promise((r) => setTimeout(r, 10))
    expect(window.api.db.setSecretConfig).toHaveBeenCalledWith('api_token', 'secret-val')
    expect(wrapper.text()).toContain('secret-val')
  })
})
```

- [ ] **Step 6: 运行单测 + typecheck**

```bash
npx vitest run tests/renderer/db-view.test.ts
npm run typecheck
```

预期：PASS，typecheck 全清（Task 8 的 preload 报错已由 Step 2 修复）。

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/register.ts src/preload/index.ts src/renderer/src/views/DbView.vue src/renderer/src/router.ts tests/renderer/db-view.test.ts
git commit -m "feat(db): 主进程 handler、preload API 与渲染验证页"
```

---

### Task 10: 入口链接与全量验证

**Files:**
- Modify: `src/renderer/src/views/HomeView.vue`

- [ ] **Step 1: HomeView 加 DB 入口链接**

修改 `src/renderer/src/views/HomeView.vue` 的 `<template>`，在 SDK POC 链接后加：

```vue
    <p><RouterLink to="/db">DB POC</RouterLink></p>
```

- [ ] **Step 2: 全量验证**

```bash
npm run typecheck
npm test
npm run build
```

预期：typecheck 通过；`npm test` 单测全绿（db + sdk 契约 + renderer，sdk 集成测试不在 `npm test` 内）；build 成功。

- [ ] **Step 3: 手动冲烟（可选，本子计划不跑）**

```bash
npm run dev
```

> 3/6 不跑 Electron 冲烟：better-sqlite3-multiple-ciphers 未做 @electron/rebuild（Node ABI），Electron 加载会崩。safeStorage 真实集成验证推迟 6/6。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/HomeView.vue
git commit -m "chore(db): HomeView 入口链接与全量验证"
```

---

## 自检记录

- **Spec 覆盖**：§3 模块结构→Task 1-7；§4 KeyProvider→Task 4；§5 schema/迁移/CRUD→Task 5/6；§6 错误→Task 2 + register wrap；§7 测试→各 Task；§8 工程集成→Task 8/9/10；§9 验收→Task 10 Step 2。
- **类型一致性**：`ConfigEntry` 在 types.ts、repositories.ts、api.ts（内联 `{key,value,updatedAt}`）、dbConfigEntrySchema 结构一致；`DbKeys` 在 key-provider.ts 定义、db-client.ts/migrations 用；`DbError` 码值在 errors.ts、register.ts wrap、验收标准一致。
- **无占位符**：所有代码块完整可执行；register.ts 的 `wrap` + ensureDbClient 完整；preload 8 方法齐全。
- **已知项 / 6/6 待办**（3/6 不跑 Electron 冲烟，以下在真实 Electron IPC 下才暴露，6/6 须处理）：
  - ① SafeStorageKeyProvider 运行时验证：3/6 用 StaticKeyProvider 测，真实 safeStorage 集成推迟 6/6。
  - ② 装 `@electron/rebuild` 并为 Electron ABI 重建 better-sqlite3-multiple-ciphers native 模块（当前 Node ABI，Electron 加载会崩）。
  - ③ `vitest.config.ts` 的 `env.ELECTRON_OVERRIDE_DIST_PATH`：本 worktree electron 二进制未装（postinstall 网络失败），`require('electron')` 触发 spawnSync 下载阻塞测试；设该 env（electron 官方 override，`index.js:30`）使其返回字符串路径，`electron?.safeStorage` 为 undefined，与计划预期的非 Electron 降级路径一致。**6/6 装好 electron 二进制后移除该 env。**
  - ④ key-provider.ts 加 `safeStorage.isEncryptionAvailable()` 检查：当前只判 `if (!safeStorage)`（undefined）。Linux 无 keyring 时 safeStorage 存在但不可用，`encryptString` 会失败——须用 `isEncryptionAvailable()` 才能正确降级。
  - ⑤ register.ts `dbClientPromise` 失败缓存：open 失败后 promise 持续 reject，后续所有 DB IPC 都返回同一 rejected promise（无重试，需重启应用）。对 essential DB 是可接受设计，但 6/6 须明确文档化或加重置逻辑。
  - ⑥ 应用退出时优雅关闭 DB：register.ts 须加 `app.on('before-quit') → dbClient.close()`（当前无 shutdown handler）。
  - ⑦ 默认 cipher sqleet（非 SQLCipher 格式），POC 自建自读够用；若需 DB Browser 等工具兼容，加 `db.pragma('cipher=sqlcipher')` 等。
  - ⑧ `require('electron')` 动态取 safeStorage，CJS 下可用；6/6 若改 ESM 须换 `createRequire`。
- **3/6 已修复的跨任务问题（终审）**：
  - ① DbView 错误显示：原 `e instanceof Error ? e.message : String(e)` 对 IPC 序列化的普通对象（非 Error 实例）会显示 `[object Object]`。已加 `errMsg(e)` 优先读 `.message`，兼容 Error 与 SerializedDbError 普通对象。
  - ② register.ts `wrap` 仅包裹 CRUD 调用、漏了 `ensureDbClient()` 的 open 失败（DB_KEY_ERROR 等）未序列化。已改为 `wrapAsync` 包裹整个 handler 体（含 open）。
  - ③ DbClient.open() 迁移失败时 db 句柄泄漏（better-sqlite3 不自动关闭）。已加 try/catch 在 migrate 失败时 closeDb 并清空 this.db。
- **tsconfig.node.json 加 `better-sqlite3-multiple-ciphers` 的 paths 映射**：该包 `exports` 字段无 `types` 条件，`moduleResolution: Bundler` 无法解析其类型（TS7016），故显式映射到 `index.d.ts`。运行时（vitest/esbuild）仍走 `exports` 的 `lib/index.js`，不受影响。
- **加密库测试须先写数据再 close**：SQLite 对"open+key+读空 sqlite_master+close"不写任何页（文件 0 字节），错误密钥重开时无加密内容可校验、不抛错。Task 5 test 2 已加 `CREATE TABLE` 触发加密页落盘；后续涉及"错误密钥"的测试同理须先写入数据页。
