# 打包与分发实施计划（子计划 6/6）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** electron-builder NSIS 打包配置（Windows x64）+ @electron/rebuild + before-quit 关库/SDK + HttpClient setConfig IPC + electron-log 日志集成。

**Architecture:** 单 electron-builder.yml（NSIS + extraResources 打包 DLL/证书 + asarUnpack native 模块 + per-user）。待办内联到现有模块（index.ts/register.ts/worker-transport/http-client）。macOS 写配置不跑 Windows 打包。

**Tech Stack:** electron-builder、@electron/rebuild、electron-log、TypeScript strict。

## Global Constraints

- 目标平台仅 Windows x64。不做 x86/macOS/Linux 打包。
- @electron/rebuild 不配 postinstall，手动 `rebuild:electron` 脚本（Windows 打包前跑）。
- `ELECTRON_OVERRIDE_DIST_PATH` 保留（vitest 用）。
- macOS 写配置代码，不实际跑 Windows 打包/安装/真实 Electron 冲烟。
- TypeScript `strict: true`；提交信息用 Conventional Commits。

---

## 文件结构（本子计划创建/修改）

- `electron-builder.yml` — 新建：NSIS 打包配置
- `build/` — 新建目录（icon.ico 等，POC 暂空/默认）
- `package.json`（修改）— 加 electron-builder/@electron/rebuild/electron-log 依赖 + dist/rebuild 脚本
- `src/main/index.ts`（修改）— electron-log 初始化 + before-quit 关库/SDK
- `src/main/ipc/register.ts`（修改）— 导出 getDbClient + http:setConfig handler
- `src/main/sdk-service/transport/worker-transport.ts`（修改）— SDK 日志转发到 electron-log
- `src/main/http-client/http-client.ts`（修改）— logError 用 electron-log
- `src/shared/ipc/channels.ts`（修改）— 加 http:set-config 通道 + httpConfigSchema
- `src/shared/ipc/api.ts`（修改）— HttpApi 加 setConfig
- `src/preload/index.ts`（修改）— window.api.http.setConfig
- `tests/shared/ipc/http-set-config-contract.test.ts` — 新建：契约单测

---

### Task 1: 依赖安装 + electron-builder.yml

**Files:**
- Modify: `package.json`
- Create: `electron-builder.yml`

- [ ] **Step 1: 安装依赖**

```bash
npm install electron-log
npm install -D electron-builder @electron/rebuild
```

- [ ] **Step 2: 加打包脚本到 package.json**

在 scripts 加：
```json
"rebuild:electron": "electron-rebuild -f -w better-sqlite3-multiple-ciphers",
"dist": "npm run build && electron-builder",
"dist:win": "npm run rebuild:electron && npm run build -- --mode=production && electron-builder --win --x64"
```

- [ ] **Step 3: 创建 electron-builder.yml**

```yaml
appId: com.code-reader.client
productName: Code Reader Client
directories:
  output: release
  buildResources: build
files:
  - out/**/*
  - package.json
extraResources:
  - from: c_sdk_lib/x64/HWPuSDK.dll
    to: native/HWPuSDK.dll
  - from: c_sdk_lib/x64/IVS_PU_Player.dll
    to: native/IVS_PU_Player.dll
  - from: c_sdk_lib/x64/cert/
    to: native/cert/
asarUnpack:
  - node_modules/better-sqlite3-multiple-ciphers/**
  - node_modules/koffi/**
win:
  target:
    - target: nsis
      arch: x64
  icon: build/icon.ico
nsis:
  oneClick: false
  perMachine: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
```

- [ ] **Step 4: 创建 build/ 目录（占位）**

```bash
mkdir -p build
```

> build/ 目录暂为空（icon.ico 需用户提供）。electron-builder 无 icon 时用默认 Electron 图标。

- [ ] **Step 5: 验证 typecheck + build**

```bash
npm run typecheck
npm run build
```

预期：typecheck 通过；build 成功（electron-builder 不参与 build，只配置文件存在）。

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json electron-builder.yml build/
git commit -m "feat(packaging): electron-builder 配置与依赖安装"
```

末尾空行加 `Co-Authored-By: Claude <noreply@anthropic.com>`

---

### Task 2: electron-log 初始化 + before-quit 关库/SDK

**Files:**
- Modify: `src/main/index.ts`, `src/main/ipc/register.ts`

- [ ] **Step 1: register.ts 导出 getDbClient**

在 `src/main/ipc/register.ts` 加：

```ts
export function getDbClient(): DbClient | null {
  return dbClient
}
```

- [ ] **Step 2: 修改 index.ts 加 electron-log 初始化 + before-quit**

修改 `src/main/index.ts`，在顶部 import 加：

```ts
import log from 'electron-log'
import { join } from 'node:path'
import { getDbClient } from './ipc/register'
import { selectBinding } from './sdk-service/binding-selector'
```

在 `const gotLock = app.requestSingleInstanceLock()` 之前加 electron-log 初始化：

```ts
// electron-log 初始化
log.transports.file.resolvePathFn = () => join(app.getPath('userData'), 'logs', 'main.log')
log.transports.file.maxSize = 10 * 1024 * 1024  // 10MB 轮转
log.transports.console.level = 'debug'
log.info('[app] starting', app.getVersion())
```

在 `app.on('window-all-closed', ...)` 之后加 before-quit：

```ts
let isQuitting = false

app.on('before-quit', (event) => {
  if (isQuitting) return
  event.preventDefault()
  isQuitting = true
  void (async () => {
    try {
      const db = getDbClient()
      if (db) {
        db.close()
        log.info('[app] database closed')
      }
    } catch (e) {
      log.error('[app] error closing database:', e)
    }
    try {
      selectBinding().cleanup()
      log.info('[app] sdk cleaned up')
    } catch (e) {
      log.error('[app] error cleaning up sdk:', e)
    }
    app.exit(0)
  })()
})
```

> 注意：`join` 已在 index.ts 顶部 import（现有代码用了 `node:path` 的 join）。检查是否重复 import——若已 import 则不加第二行。
> `selectBinding` 从 `./sdk-service/binding-selector` 导入。在 macOS 上 `selectBinding()` 返回 mockBinding，`cleanup()` 返回 true（不抛错）。生产环境返回 realBinding，cleanup 调 `IVS_PU_Cleanup()`。
> `void (async () => { ... })()` — async IIFE 用 void 标注避免 unhandled promise warning。

- [ ] **Step 3: 验证 typecheck**

```bash
npm run typecheck
```

预期：通过。

> **潜在 typecheck 问题：** `electron-log` 的类型声明——如果 `import log from 'electron-log'` 报类型问题，检查 electron-log 是否有 .d.ts（通常自带）。`log.transports.file.resolvePathFn` 的类型——可能需要 `as` 断言。若报错，报告具体错误。

- [ ] **Step 4: 验证 build + test**

```bash
npm run build
npm test
```

预期：build 成功；npm test 全绿（before-quit 不影响测试——它只在 Electron 运行时触发）。

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts src/main/ipc/register.ts
git commit -m "feat(packaging): electron-log 初始化与 before-quit 关库/SDK"
```

---

### Task 3: HttpClient setConfig IPC（方案 B）

**Files:**
- Modify: `src/shared/ipc/channels.ts`, `src/shared/ipc/api.ts`, `src/main/ipc/register.ts`, `src/preload/index.ts`
- Create: `tests/shared/ipc/http-set-config-contract.test.ts`

- [ ] **Step 1: 扩展 channels.ts**

在 `src/shared/ipc/channels.ts` 的 `HTTP_CHANNELS` 加 `setConfig`：

```ts
export const HTTP_CHANNELS = {
  get: 'http:get',
  post: 'http:post',
  put: 'http:put',
  delete: 'http:delete',
  setToken: 'http:set-token',
  setRefreshToken: 'http:set-refresh-token',
  clearTokens: 'http:clear-tokens',
  setConfig: 'http:set-config'          // 新增
} as const
```

在 http schema 区域加：

```ts
export const httpConfigSchema = z.object({
  baseUrl: z.string(),
  refreshUrl: z.string(),
  timeoutMs: z.number().int().positive().optional(),
  maxRetries: z.number().int().positive().optional()
})
```

- [ ] **Step 2: 扩展 api.ts**

在 `src/shared/ipc/api.ts` 的 `HttpApi` 加：

```ts
  setConfig(config: { baseUrl: string; refreshUrl: string; timeoutMs?: number; maxRetries?: number }): Promise<void>
```

- [ ] **Step 3: 写契约单测**

`tests/shared/ipc/http-set-config-contract.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { validate } from '../../../src/shared/ipc/validate'
import { httpConfigSchema } from '../../../src/shared/ipc/channels'

describe('HTTP setConfig 契约', () => {
  it('合法配置通过', () => {
    const c = { baseUrl: 'http://api', refreshUrl: 'http://api/refresh' }
    expect(validate(httpConfigSchema, c)).toEqual(c)
  })

  it('带可选字段通过', () => {
    const c = { baseUrl: 'http://api', refreshUrl: 'http://api/refresh', timeoutMs: 5000, maxRetries: 2 }
    expect(validate(httpConfigSchema, c)).toEqual(c)
  })

  it('缺 refreshUrl 被拒', () => {
    expect(() => validate(httpConfigSchema, { baseUrl: 'http://api' })).toThrow()
  })

  it('timeoutMs 非正整数被拒', () => {
    expect(() => validate(httpConfigSchema, { baseUrl: 'http://api', refreshUrl: 'http://r', timeoutMs: -1 })).toThrow()
    expect(() => validate(httpConfigSchema, { baseUrl: 'http://api', refreshUrl: 'http://r', timeoutMs: 1.5 })).toThrow()
  })
})
```

- [ ] **Step 4: 修改 register.ts 加 setConfig handler**

在 `src/main/ipc/register.ts` 顶部 import 加：

```ts
import { httpConfigSchema } from '@shared/ipc/channels'
import { DbHttpConfig } from '../http-client/config'
```

> DbHttpConfig 可能已在 register.ts import（子计划 4 引入）——检查是否已 import，避免重复。

在 http handler 区域（clearTokens 之后）加：

```ts
  ipcMain.handle(HTTP_CHANNELS.setConfig, (_e, config) =>
    wrapHttp(async () => {
      const db = await ensureDbClient()
      const configStore = new DbHttpConfig({
        getAppConfig: async (key) => db.getAppConfig(key),
        setAppConfig: async (key, value) => db.setAppConfig(key, value)
      })
      await configStore.set(validate(httpConfigSchema, config))
      // 失效 httpClient，下次 ensureHttpClient 重建（读新配置）
      httpClient = null
      httpClientPromise = null
    })
  )
```

- [ ] **Step 5: 修改 preload 加 setConfig**

在 `src/preload/index.ts` 的 `http` 对象加：

```ts
    setConfig: (config) => ipcRenderer.invoke(HTTP_CHANNELS.setConfig, config),
```

- [ ] **Step 6: 运行单测 + typecheck**

```bash
npx vitest run tests/shared/ipc/http-set-config-contract.test.ts
npm run typecheck
```

预期：PASS，typecheck 全清。

- [ ] **Step 7: Commit**

```bash
git add src/shared/ipc/channels.ts src/shared/ipc/api.ts src/main/ipc/register.ts src/preload/index.ts tests/shared/ipc/http-set-config-contract.test.ts
git commit -m "feat(packaging): HttpClient setConfig IPC（重建实例）"
```

---

### Task 4: SDK 日志转发 + HttpClient logError 用 electron-log

**Files:**
- Modify: `src/main/sdk-service/transport/worker-transport.ts`, `src/main/http-client/http-client.ts`

- [ ] **Step 1: worker-transport.ts 加 SDK 日志转发**

在 `src/main/sdk-service/transport/worker-transport.ts` 顶部 import 加：

```ts
import log from 'electron-log'
```

修改 `handleMessage` 方法，在 `if (msg.type === 'event')` 分支里加日志判断：

```ts
  private handleMessage(msg: WorkerOutbound): void {
    if (msg.type === 'event') {
      const data = msg.data as { kind?: string } | undefined
      if (data?.kind === 'log') {
        const logData = msg.data as { level: number; file: string; line: number; msg: string }
        log.debug(`[SDK] [L${logData.level}] ${logData.file}:${logData.line} ${logData.msg}`)
        return  // 日志事件不转发到渲染进程
      }
      this.emitter.emit('data', msg.data)
      return
    }
    // ... 现有 result 处理不变
  }
```

> 日志事件 `{ kind: 'log', level, file, line, msg }` 由 real-binding 的 registerLogCallback 投递（经 worker postMessage）。WorkerTransport 拦截后转发到 electron-log，不 emit 到渲染（不污染 SDK 事件流）。

- [ ] **Step 2: http-client.ts logError 用 electron-log**

在 `src/main/http-client/http-client.ts` 顶部 import 加：

```ts
import log from 'electron-log'
```

修改 `logError` 方法：

```ts
  private logError(method: string, path: string, err: HttpError, attempt: number): void {
    log.warn(`[http] ${method} ${path} attempt=${attempt} failed: ${err.kind} ${err.status ?? ''} ${err.message}`)
  }
```

> 把 `console.debug` 替换为 `log.warn`（错误日志用 warn 级别）。日志不含 token（与现有脱敏逻辑一致——logError 从不打印 headers）。

- [ ] **Step 3: 验证 typecheck + test**

```bash
npm run typecheck
npm test
```

预期：typecheck 通过；npm test 全绿。

> **潜在问题：** `electron-log` 在 vitest 环境（非 Electron）import 可能报错——它依赖 Electron `app.getPath`。但 http-client.ts 的测试用 FakeTransport（不触发 logError 的实际调用，只在请求失败时调）。若 typecheck 通过但 vitest 运行时 import electron-log 崩，需在 http-client.ts 里用动态 import 或条件加载。先跑看结果——若崩，报告错误。

- [ ] **Step 4: Commit**

```bash
git add src/main/sdk-service/transport/worker-transport.ts src/main/http-client/http-client.ts
git commit -m "feat(packaging): SDK 日志与 HttpClient 日志转发到 electron-log"
```

---

### Task 5: 全量验证

**Files:**
- 无新文件

- [ ] **Step 1: 全量验证**

```bash
npm run typecheck
npm test
npm run test:integration
npm run build
```

预期：typecheck 通过；npm test 全绿（110）；集成测试全绿（19）；build 成功。

- [ ] **Step 2: 文档化 Windows 打包流程**

在 README.md 末尾加打包说明：

```markdown
## Windows 打包（Windows 环境）

1. 确保证书文件在 `c_sdk_lib/x64/cert/`（cacert.cer, cert.pem, key.pem）
2. `npm install`
3. `npm run rebuild:electron`（把 native 模块编译成 Electron ABI）
4. `npm run dist:win`（一键打包：rebuild → build → electron-builder NSIS）
5. 产出 `release/` 目录下的 NSIS 安装包

> macOS 开发机不可跑 rebuild:electron（需 Windows 编译环境）。
> 测试在 macOS 用 `npm test`（Node ABI，不需 rebuild）。
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: Windows 打包流程说明"
```

---

## 自检记录

- **Spec 覆盖**：§3 electron-builder→Task 1；§4 @electron/rebuild→Task 1 脚本；§5 before-quit→Task 2；§6 setConfig→Task 3；§7 electron-log→Task 2+4；§8 测试/验收→Task 5。
- **类型一致性**：httpConfigSchema 在 channels.ts、register.ts validate、api.ts HttpApi.setConfig、preload 一致；getDbClient 返回 DbClient|null；electron-log import 在 index.ts/worker-transport/http-client 一致。
- **无占位符**：所有代码块完整可执行。
- **已知项**：
  - ① electron-log 在 vitest（非 Electron）import 可能崩——http-client.ts 测试用 FakeTransport 不触发 logError，但模块顶层 `import log` 会执行。若崩，改为动态 import（`const log = require('electron-log')` 在 logError 内）或条件加载。Task 4 Step 3 已标注。
  - ② build/icon.ico 需用户提供（POC 用默认 Electron 图标）。
  - ③ 证书文件需用户放到 c_sdk_lib/x64/cert/（真实 SDK 集成已标注）。
  - ④ electron-builder 打包/NSIS 安装/真实 Electron 冲烟推迟 Windows 环境。
  - ⑤ selectBinding 在 before-quit 调 cleanup——macOS 返回 mockBinding（cleanup 返回 true，不抛错）；Windows 返回 realBinding（调 IVS_PU_Cleanup）。
