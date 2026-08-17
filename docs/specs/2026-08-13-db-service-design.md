# 数据库与加密层（db-service）设计

- 日期：2026-08-13
- 状态：待审阅
- 需求来源：`docs/specs/2026-08-11-code-reader-client-design.md` §5、§11
- 上游产物：子计划 1/6（工程脚手架）、2/6（sdk-service POC），均已合并到 main
- 范围：子计划 3/6

## 1. 背景与目标

设计文档 §5 规定客户端用 SQLite + SQLCipher 全库加密存储配置，§11 #2 把 `better-sqlite3-multiple-ciphers` 的 Electron ABI 匹配列为已知风险。

本子计划目标：**建立加密配置库的完整骨架**——加密库打开、可插拔密钥管理、3 表 schema 与迁移、app_config/secret_config CRUD（含字段级二次加密）、类型化错误，并经 IPC 暴露到渲染进程可验证。

**约束确认：**
- 引擎既定：`better-sqlite3-multiple-ciphers`（用户确认其他项目已在用）。
- 交付边界：骨架 + CRUD。备份/恢复、用户口令派生密钥（scrypt/PBKDF2）留到后续子计划。
- 测试策略：可插拔 `KeyProvider` + 测试桩（`StaticKeyProvider`），vitest 跑全部 DB 逻辑（Node ABI）；`safeStorage` 真实集成推迟到 6/6（Electron 手动冲烟）。
- native ABI：3/6 保持 Node ABI（vitest 可加载）；`@electron/rebuild` + Electron 内冲烟放到打包子计划（6/6）。本子计划不跑 Electron 手动冲烟。
- secret_config 含字段级二次加密（AES-256-GCM，独立 fieldKey）。

## 2. 方案选择

采用 **KeyProvider 返回 `DbKeys { dbKey, fieldKey }`**（方案 A）。

| 方案 | 说明 | 结论 |
|---|---|---|
| A. KeyProvider 返回 `{ dbKey, fieldKey }` | 一个抽象管两把密钥；默认 SafeStorageKeyProvider 存两把随机密钥；测试 StaticKeyProvider 给固定密钥 | 采用 |
| B. KeyProvider（仅 dbKey）+ 独立 FieldCipher 服务 | 两个抽象解耦，可单独轮换 fieldKey，但多组件、多一处密钥存储，POC 偏重 | 否决 |
| C. fieldKey 从 dbKey 经 HKDF 派生 | 存储最简，但 dbKey 轮换连带 fieldKey 轮换，已加密旧值无法解密，耦合强 | 否决 |

理由：方案 A 单一抽象（测试桩简单），两把密钥独立存在（轮换语义清晰、不耦合），POC 复杂度最低。

## 3. 模块结构

```
src/main/db-service/
├── key-provider.ts       # KeyProvider 接口 + DbKeys 类型；SafeStorageKeyProvider（默认）；StaticKeyProvider（测试桩）
├── field-cipher.ts       # AES-256-GCM 字段级加解密（用 fieldKey）
├── db.ts                 # 打开/关闭加密库（better-sqlite3-multiple-ciphers，Pragma key）
├── migrations.ts         # schema_migrations 版本检测 + 迁移（建三表）
├── repositories.ts       # app_config CRUD（明文）+ secret_config CRUD（value 经 field-cipher 加解密）
├── errors.ts             # DbError + translateDbError
├── types.ts              # 对外 TS 接口（ConfigEntry 等，无 SQL 细节）
└── db-client.ts          # DbClient facade：open/init + getAppConfig/setAppConfig/getSecretConfig/setSecretConfig/close

src/shared/ipc/
├── channels.ts（扩展）   # DB_CHANNELS + zod schema
└── api.ts（扩展）        # RendererApi.db: { ... }

src/main/ipc/register.ts（扩展） # db handler → DbClient
src/preload/index.ts（扩展）     # window.api.db.*
src/renderer/src/views/DbView.vue + router /db  # 验证页
```

### 关键决策

- **DbClient 是 facade**，主进程单例（类似 SdkClient）。持有 db 连接 + fieldKey，对外只暴露业务方法，不暴露 SQL/Buffer。
- **app_config vs secret_config**：app_config.value 直接存（库级 SQLCipher 已加密，非敏感）；secret_config.value 经 field-cipher 二次加密后存 BLOB。两套 repository 方法。
- **KeyProvider 可插拔**：`SafeStorageKeyProvider`（默认，Electron 运行时）+ `StaticKeyProvider`（测试桩）。DbClient 构造时注入。
- **不进 worker**：better-sqlite3 是同步 API，主进程直跑即可（不像 C SDK 需 worker 隔离阻塞）。若实测阻塞 UI 再考虑 worker，POC 不做。

## 4. KeyProvider 与密钥管理

### 4.1 接口

```ts
interface DbKeys {
  dbKey: Buffer    // 32 字节，传给 SQLCipher（Pragma key）
  fieldKey: Buffer // 32 字节，AES-256-GCM 字段级加密
}

interface KeyProvider {
  loadKeys(): Promise<DbKeys>      // 启动时取密钥
  saveKeys(keys: DbKeys): Promise<void>  // 首次生成后持久化
}
```

### 4.2 SafeStorageKeyProvider（默认，Electron 运行时）

- 密钥存 `userData/db-keys.bin`（一个文件，含两把 32 字节密钥），整文件用 `safeStorage.encryptString` 加密后落盘。
- `loadKeys`：读文件 → `safeStorage.decryptString` → 拆出两把密钥；文件不存在则生成两把随机密钥 → `saveKeys` 持久化 → 返回。
- safeStorage 不可用（非 Electron / 平台不支持）时抛 `DbError(DB_KEY_ERROR, 'safeStorage unavailable')`——这也是测试用 StaticKeyProvider 绕开它的原因。

### 4.3 StaticKeyProvider（测试桩）

- 构造时传入固定 `DbKeys`（或内存生成），不碰文件系统、不碰 safeStorage。vitest 全程用它跑真实库逻辑。

### 4.4 密钥与库的关系

- `dbKey` → `PRAGMA key = "x'<hex>'"`（SQLCipher hex key 格式）打开加密库。
- `fieldKey` → 仅 field-cipher 用，不进 SQL。
- 密钥错误时：打开库或首次 SQL 报 `SQLITE_NOTADB`/`SQLITE_AUTH` → 翻译成 `DbError(DB_KEY_ERROR)`。

### 4.5 POC 边界

- 不做密钥轮换、不做用户口令派生（scrypt/PBKDF2 KeyProvider 留后续）。
- safeStorage 真实集成只在 Electron 手动冲烟（6/6 重建 ABI 后）；3/6 用 StaticKeyProvider 跑 vitest。

## 5. Schema、迁移与 CRUD

### 5.1 Schema（3 张表）

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS secret_config (
  key   TEXT PRIMARY KEY,
  value BLOB NOT NULL,          -- AES-256-GCM 密文（nonce+tag+ciphertext）
  updated_at TEXT NOT NULL
);
```

- `app_config.value` 是 TEXT 直接存（库级 SQLCipher 已加密，非敏感配置）。
- `secret_config.value` 是 BLOB——field-cipher 加密后的密文（nonce 12 字节 + tag 16 字节 + ciphertext 拼成一个 Buffer 存入）。

### 5.2 迁移机制

- `migrations.ts` 维护有序迁移数组（POC 只有 v1：建三表）。
- 打开库后立即检测：查 `schema_migrations` 表是否存在 + 最大 version。
- 若 `schema_migrations` 不存在 → 库全新或密钥错误（首次 SQL 抛错 → 区分 `SQLITE_NOTADB` 为 DB_KEY_ERROR）。
- 逐个应用未执行的迁移，每条用事务包住，成功后写 `schema_migrations`。
- 同步执行（better-sqlite3 同步 API），不需 async。

### 5.3 CRUD（repositories.ts）

**app_config（明文 value）**
- `getAppConfig(key) → string | null`
- `setAppConfig(key, value) → void`（upsert，更新 `updated_at`）
- `deleteAppConfig(key) → void`
- `listAppConfig() → ConfigEntry[]`

**secret_config（value 经 field-cipher 二次加密）**
- `getSecretConfig(key) → string | null`（读 BLOB → field-cipher 解密 → 返回明文）
- `setSecretConfig(key, value) → void`（明文 → field-cipher 加密 → 存 BLOB，upsert）
- `deleteSecretConfig(key) → void`
- `listSecretConfig() → ConfigEntry[]`（逐条解密 value）

**事务**：每个写操作用 `db.transaction()` 包住（better-sqlite3 同步事务）。

### 5.4 关键决策

- secret_config 的加密/解密对上层透明：repository 内部调 field-cipher，DbClient/facade 只看到明文 `string`。渲染进程永远拿不到 fieldKey。
- 密钥错误检测：打开库后跑一条 `SELECT 1`，若抛 `SQLITE_NOTADB`/`SQLITE_AUTH` → `DbError(DB_KEY_ERROR)`；其他 SQL 异常按 `SQLITE_CORRUPT` 或 `DB_UNKNOWN` 分类。
- 不做：索引（POC 数据量小）、外键约束、软删除、批量分页。

## 6. 错误处理

### 6.1 DbError 类型

```ts
class DbError extends Error {
  readonly code: string        // DB_KEY_ERROR | DB_CORRUPT | DB_NOT_OPEN | DB_UNKNOWN
  readonly category: 'key' | 'schema' | 'io' | 'unknown'
  readonly retryable: boolean
}
```

### 6.2 错误码与触发场景

| code | category | retryable | 触发场景 |
|---|---|---|---|
| `DB_KEY_ERROR` | key | false | SQLCipher 密钥错误（`SQLITE_NOTADB`/`SQLITE_AUTH`）；safeStorage 不可用 |
| `DB_CORRUPT` | schema | false | 库文件损坏（`SQLITE_CORRUPT`）、schema 迁移失败 |
| `DB_NOT_OPEN` | io | true | 操作在库未打开时调用 |
| `DB_UNKNOWN` | unknown | true | 其他未分类 SQL 异常 |

### 6.3 翻译机制

- `errors.ts` 里 `translateDbError(sqliteError)`：取 better-sqlite3 抛出的 `code`（如 `'SQLITE_NOTADB'`、`'SQLITE_CORRUPT'`、`'SQLITE_AUTH'`）映射到 DbError。
- better-sqlite3 错误对象有 `.code`（SQLITE_* 字符串）和 `.message`，翻译时保留原始 message 拼进 DbError.message。
- 不属于已知码的 → `DB_UNKNOWN`（retryable: true，保守可重试）。

### 6.4 错误传播到渲染

- 沿用 sdk-service 模式：DbClient 方法抛 DbError → IPC handler 捕获 → 序列化成 `SerializedDbError`（纯数据，可跨 IPC）→ preload 透传 → 渲染拿到 DbError（业务语义，不接触 SQLITE_* 码）。
- 渲染层只看 `code` 决定 UI 提示：`DB_KEY_ERROR` → "密钥问题，请联系管理员"；`DB_CORRUPT` → "数据库损坏"；其他 → "操作失败，请重试"。

### 6.5 关键决策

- 密钥错误是 fatal、不可重试：`DB_KEY_ERROR` retryable=false，渲染不应自动重试。
- `DB_NOT_OPEN` 可重试：通常时序问题（库未初始化好就调用）。
- 不在 POC 做：错误恢复流程（如密钥错误后引导用户重置）、自动备份触发。只做"识别 + 翻译 + 透传"。

## 7. 测试策略

### 7.1 单元测试（vitest，Node ABI，StaticKeyProvider）

全程用 `StaticKeyProvider`（固定密钥）+ 真实的 better-sqlite3-multiple-ciphers（Node ABI），在临时文件跑真实加密库。不碰 safeStorage、不碰 Electron。

- **key-provider**：StaticKeyProvider 返回固定 DbKeys；SafeStorageKeyProvider 仅测"safeStorage 不可用时抛 DB_KEY_ERROR"（mock safeStorage 为 undefined）。
- **field-cipher**：加密 → 解密往返一致；不同密钥解密失败（GCM tag 校验）；空字符串能处理。
- **db 打开**：正确密钥打开成功；错误密钥 → `DB_KEY_ERROR`；库文件不存在 → 自动创建；已存在的库能重新打开。
- **migrations**：全新库 → 建三表 + 写 schema_migrations v1；重复打开 → 不重复迁移。
- **app_config CRUD**：set/get/delete/list、upsert 更新 updated_at、get 不存在的 key 返回 null。
- **secret_config CRUD**：set 后 get 返回原明文（加解密往返）、密文确实是 BLOB 且与明文不同、delete、list。
- **errors**：translateDbError 各 SQLITE_* 码映射正确。
- **DbClient facade**：open 后各方法可用；close 后调用 → `DB_NOT_OPEN`。

### 7.2 集成测试（vitest，同一套环境）

端到端一条路径：open(init keys + migrate) → setAppConfig → getAppConfig → setSecretConfig → getSecretConfig（验证字段加密往返）→ close → 重新 open（用同一 StaticKeyProvider）→ 旧数据还在。

### 7.3 测试隔离

- 每个测试用例用唯一的临时库路径（`os.tmpdir()` + 唯一名），`afterEach` 删库文件，互不污染。
- 不用内存库（`:memory:`）——因为要验证"落盘 + 重新打开"，必须用真实文件。

### 7.4 safeStorage 真实集成

- 3/6 不测：safeStorage 要 Electron 运行时，better-sqlite3 要 Electron ABI，3/6 都不具备。
- 代码写出来（SafeStorageKeyProvider），运行时验证推迟到 6/6（@electron/rebuild 后手动冲烟）。

### 7.5 不在 POC 测

- 备份/恢复（留后续子计划）。
- 用户口令派生密钥（留后续）。
- 并发写（better-sqlite3 同步串行，无并发问题）。

### 7.6 与现有测试配置的关系

- db-service 测试放 `tests/db/**`（不放 `tests/sdk/**`）。
- `vitest.config.ts` 的 `exclude` 已排除 `tests/sdk/**` 与 `.worktrees/**`；db 测试默认纳入 `npm test`（不需构建产物，纯 Node ABI）。
- 首要验证点：装 `better-sqlite3-multiple-ciphers` 后 vitest 能否加载它（Task 1 的 load 冒烟）。

## 8. 交付清单（本子计划产出）

- `src/main/db-service/` — key-provider/field-cipher/db/migrations/repositories/errors/types/db-client
- `src/main/ipc/register.ts`（扩展）— db handler
- `src/shared/ipc/{channels,api}.ts`（扩展）— db 契约
- `src/preload/index.ts`（扩展）— `window.api.db`
- `src/renderer/src/views/DbView.vue` + router `/db` — 验证页
- `tests/db/` — 单测 + 集成测试
- `package.json` — 加 `better-sqlite3-multiple-ciphers` 依赖

## 9. 验收标准

- `better-sqlite3-multiple-ciphers` 安装后 vitest（Node ABI）可加载。
- `npm run typecheck`、`npm test`（含 db 单测/集成）、`npm run build` 全绿。
- 集成测试覆盖：加密库打开、密钥错误检测、3 表迁移、app_config/secret_config CRUD（含字段加密往返）、落盘重开。
- DbClient facade 经 IPC 暴露到渲染（`window.api.db.*`）。
- KeyProvider 可插拔：StaticKeyProvider 跑测试，SafeStorageKeyProvider 代码就位（运行时验证推迟 6/6）。
- 错误码 `DB_KEY_ERROR`/`DB_CORRUPT`/`DB_NOT_OPEN` 类型化并经 IPC 透传到渲染。
