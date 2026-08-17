# 打包与分发设计（子计划 6/6）

- 日期：2026-08-17
- 状态：待审阅
- 需求来源：`docs/superpowers/specs/2026-08-11-code-reader-client-design.md` §8、§10、§11
- 上游产物：子计划 1-5 + 真实 SDK 集成，均已合并到 main
- 范围：子计划 6/6

## 1. 背景与目标

子计划 1-5 建立了完整的客户端架构（脚手架/sdk-service/db-service/http-client/use-cases），真实 SDK 集成完成了 HWPuSDK 的初始化与二层搜索。本子计划是最后一个：打包分发 + 清理前 5 个子计划积累的 6/6 待办。

**约束确认：**
- 目标平台：仅 Windows x64。不做 x86、不做 macOS/Linux 打包。
- native 模块预编译打包（不在用户机器上编译）。@electron/rebuild 在构建时（开发者机器上）把 better-sqlite3-multiple-ciphers 编译成 Electron x64 ABI。
- 不配 postinstall（避免每次 install 后 vitest 崩）。手动 `rebuild:electron` 脚本，打包前跑。
- `ELECTRON_OVERRIDE_DIST_PATH` 保留（vitest 用，与 rebuild 无关）。
- macOS 开发机写打包配置代码，不实际跑 Windows 打包（文档化 Windows 打包流程）。

**待办清理（4 项，全选）：**
- ① @electron/rebuild 配置（构建时预编译 native 模块为 Electron ABI）
- ② before-quit 关库/SDK（优雅退出）
- ③ HttpClient config seed（方案 B：setConfig IPC + 重建实例）
- ④ electron-log 日志集成（持久化到 userData/logs/）

## 2. 方案选择

采用 **单 electron-builder.yml + 待办内联到现有模块**（方案 A）。

| 方案 | 说明 | 结论 |
|---|---|---|
| A. 单配置 + 内联 | 一个 electron-builder.yml + 多环境用 mode 注入 + 待办改现有模块 | 采用 |
| B. 多环境分离 + 独立模块 | 按 dev/test/prod 分三个 builder 配置 | POC 过度 |

## 3. electron-builder 配置与资源打包

### 3.1 electron-builder.yml

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

### 3.2 关键决策

- **extraResources**：DLL（HWPuSDK.dll + IVS_PU_Player.dll）+ 证书目录打进 `resources/native/`。运行时 `process.resourcesPath + '/native/'` 取 DLL，`+ '/native/cert/'` 取证书。
- **asarUnpack**：better-sqlite3-multiple-ciphers 和 koffi 的 `.node` 二进制从 asar 包里解出来（native 模块不能在 asar 内加载）。
- **NSIS per-user**（perMachine: false）：免 UAC，装到 %LOCALAPPDATA%，内网易分发。
- **仅 x64**：win.target 只配 nsis + x64。
- **files**：只打包 out/ + package.json。src/tests/docs 不打进安装包。
- **图标**：build/icon.ico（需提供，POC 可暂用默认）。
- **版本**：从 package.json version 注入。

### 3.3 多环境配置

electron-vite mode 机制 + 环境变量注入：
- `npm run dev`（mode=development）
- `npm run build -- --mode=test`（VITE_API_BASE_URL=test 环境）
- `npm run build -- --mode=production`（生产）

`.env.production`、`.env.test` 放 API 地址等，electron-vite 自动注入到 `import.meta.env`。运行时设置页可改（持久化到 db app_config，子计划 4 已支持）。

### 3.4 打包脚本

```json
"rebuild:electron": "electron-rebuild -f -w better-sqlite3-multiple-ciphers",
"dist": "npm run build && electron-builder",
"dist:win": "npm run rebuild:electron && npm run build -- --mode=production && electron-builder --win --x64"
```

- rebuild:electron：打包前把 native 模块编译成 Electron x64 ABI（Windows 机器上跑）。
- dist:win：一键打包（rebuild → build → electron-builder）。
- macOS 上 dist:win 可交叉打包 electron-builder 配置，但 rebuild:electron 需要 Windows 环境。

## 4. @electron/rebuild 配置

```json
// devDependencies 加
"@electron/rebuild": "^latest"

// scripts 加
"rebuild:electron": "electron-rebuild -f -w better-sqlite3-multiple-ciphers"
```

### 关键决策

- **不配 postinstall**：避免每次 npm install 后 vitest 因 ABI 不匹配崩。
- **手动 rebuild**：Windows 打包前跑一次。
- **koffi 不需要 rebuild**：预编译多平台二进制。
- **ELECTRON_OVERRIDE_DIST_PATH 保留**：vitest 用，与 rebuild 无关。

### ABI 流程

```
开发流程（macOS）：
  npm install → Node ABI → vitest 全绿（不跑 Electron，不 rebuild）

打包流程（Windows）：
  npm install → Node ABI
  npm run rebuild:electron → Electron ABI
  npm run build → electron-vite build
  electron-builder → NSIS 安装包（native 模块已是 Electron ABI）
```

## 5. before-quit 关库/SDK

### 5.1 实现

修改 `src/main/index.ts`，加退出处理：

```ts
let isQuitting = false

app.on('before-quit', (event) => {
  if (isQuitting) return
  event.preventDefault()
  isQuitting = true
  ;(async () => {
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

### 5.2 register.ts 导出 client 引用

```ts
export function getDbClient(): DbClient | null {
  return dbClient
}
```

### 5.3 关键决策

- event.preventDefault() + async 关闭 + app.exit(0)：before-quit 是同步事件，preventDefault 阻止默认退出，异步完成后手动退出。
- isQuitting 防重入：app.exit(0) 再次触发 before-quit，用 flag 跳过。
- cleanup 不阻塞退出：try/catch 吞掉关闭错误（已尽最大努力）。

## 6. HttpClient config seed（方案 B）

### 6.1 IPC 通道扩展

channels.ts 加 `http:set-config` 通道 + `httpConfigSchema`。
api.ts 的 HttpApi 加 `setConfig(config): Promise<void>`。

### 6.2 register.ts handler + 重建实例

```ts
ipcMain.handle(HTTP_CHANNELS.setConfig, (_e, config) =>
  wrapHttp(async () => {
    const db = await ensureDbClient()
    const configStore = new DbHttpConfig({
      getAppConfig: async (key) => db.getAppConfig(key),
      setAppConfig: async (key, value) => db.setAppConfig(key, value)
    })
    await configStore.set(validate(httpConfigSchema, config))
    httpClient = null
    httpClientPromise = null
  })
)
```

### 6.3 关键决策

- 失效重建：httpClientPromise = null + httpClient = null，下次 ensureHttpClient 重新创建实例（读新配置）。
- configStore.set 持久化到 db app_config。
- 不影响 token：重建只换 config，token 从 DbTokenStore 重新读。

## 7. electron-log 日志集成

### 7.1 安装与初始化

```json
"electron-log": "^latest"
```

`src/main/index.ts` 初始化：
```ts
import log from 'electron-log'
log.transports.file.resolvePathFn = () => join(app.getPath('userData'), 'logs', 'main.log')
log.transports.file.maxSize = 10 * 1024 * 1024  // 10MB 轮转
log.transports.console.level = 'debug'
```

### 7.2 SDK 日志回调转发

worker 里不能直接 import electron-log（依赖主进程 API）。SDK 日志回调 → `postMessage({kind:'log'})` → 主进程 WorkerTransport 接收 → `log.debug`。

worker-transport.ts 的 handleMessage 加日志分支：
```ts
if (data && data.kind === 'log') {
  log.debug(`[SDK] [L${data.level}] ${data.file}:${data.line} ${data.msg}`)
  return  // 不转发到渲染
}
```

### 7.3 HttpClient 日志转发

http-client.ts 的 logError：
```ts
import log from 'electron-log'
private logError(...): void {
  log.warn(`[http] ${method} ${path} attempt=${attempt} failed: ...`)
}
```

### 7.4 关键决策

- worker 日志经 MessagePort 转发（worker 不能直接用 electron-log）。
- HttpClient 直接用 electron-log（主进程跑）。
- 日志级别：SDK 用 debug，HttpClient 错误用 warn，退出用 info/error。
- 文件轮转：10MB。
- 不做：日志导出诊断包（留后续）。

## 8. 测试策略与验收

### 8.1 测试策略

- 不新增运行时测试（改动多依赖 Electron 运行时，vitest 无法覆盖）。
- typecheck 验证所有新代码类型正确。
- 现有测试不回归（npm test + test:integration 全绿）。
- 新增 setConfig 契约测试（httpConfigSchema 校验）。

### 8.2 验收标准

- npm run typecheck 通过。
- npm test 全绿（109 + 1 setConfig 契约 = 110）。
- npm run test:integration 全绿（19，不回归）。
- npm run build 成功。
- electron-builder.yml 配置就位。
- rebuild:electron 脚本就位（不跑，文档化）。
- before-quit / setConfig / electron-log 代码就位（运行时验证推迟 Windows）。
- 打包/安装/真实 Electron 冲烟推迟 Windows 环境。
