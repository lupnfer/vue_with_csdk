# 客户端框架选型与设计方案

- 日期：2026-08-11
- 状态：待审阅
- 需求来源：`require.md`
- 技术选型结论：**Electron + Vue 3 + TypeScript**

## 1. 需求摘要

构建一个 Vue 3 桌面客户端，采用 CS（客户端/服务端）架构：

- 主体通信走 RESTful（HTTPS）与外部服务端交互。
- 部分功能通过集成 C SDK 实现，C SDK 在客户端本地执行（纯浏览器无法加载 C 库）。
- C SDK 接口复杂：结构体嵌套、回调、异步、手动内存管理、内部多线程。
- 客户端需要数据库记录一部分 client 配置，且支持加密。

约束确认：

- 部署平台：Windows 单平台（x64 / x86）。
- 分发方式：企业内部使用，NSIS/Inno Setup 安装包手动分发，无自动更新。
- 团队技术栈：熟悉 Node.js，Rust 能力一般。
- C SDK 形态：仅提供 C 接口的库（DLL / 静态库 + C 头文件），无 Node/Rust/C# 语言封装；x86/x64 均提供。

## 2. 选型决策与理由

采用 **Electron + Vue 3**。完整对比表已归档到 `require.md`（框架选型对比章节），核心依据：

1. C SDK 是最大风险点（结构体嵌套、回调、异步、手动内存、内部多线程），Node 侧接入路径最成熟（Koffi 纯 JS FFI 可直接对接 C 接口，无需 C++）。
2. 团队熟悉 Node.js，主进程纯 TypeScript 即可维护，无需引入 C++/Rust。
3. 企业内部分发、无自动更新场景下，Electron 的体积/内存劣势不构成问题。
4. Electron 自带 Chromium，渲染一致性可控，无 WebView2 运行时依赖。

## 3. 总体架构

采用 Electron 三层模型：主进程（Main）、Preload 桥接、渲染进程（Renderer）。

核心原则：**C SDK 和数据库只存在于主进程侧，渲染进程保持纯净**。

### 3.1 进程与模块划分

- **主进程**：唯一持有 C SDK 生命周期与数据库连接。C SDK 调用放入 worker_threads，避免阻塞/回调卡死 UI 事件循环。
- **渲染进程**：Vue 3 SPA，负责 UI 与交互；开启 `contextIsolation`、关闭 `nodeIntegration`。
- **Preload**：通过 `contextBridge` 暴露白名单 API（`sdk.*`、`db.*`、`http.*`），跨进程通信走类型化 IPC 通道，渲染进程只拿到 Promise。
- **网络层**：RESTful HTTPS 请求放主进程，统一管理 TLS、代理、Token。
- **业务编排**：新增 use-cases 层，将 sdk-service / db-service / http-client 串成业务动作，数据流单向：UI → use-case → (sdk / db / http)。

模块清单（每个模块独立、可单测）：

| 模块 | 职责 | 依赖 |
|---|---|---|
| `sdk-service` | C SDK 加载、调用、回调转发、释放 | worker_threads、Koffi |
| `db-service` | SQLCipher 加密库读写、迁移、备份 | better-sqlite3、KeyProvider |
| `http-client` | REST 请求、鉴权、重试、代理、证书 | Electron net |
| `ipc-bridge` | 类型化通道定义与参数校验 | zod、shared |
| `use-cases` | 业务编排 | 以上三个服务 |
| `ui`（Vue 3） | 页面、状态、交互 | Pinia、Vue Router |

### 3.2 进程模型备选与演进

- 默认：主进程 + worker_threads（结构最简单，全 TS 可维护）。
- 可选增强：`utilityProcess` 独立子进程承载 C SDK，提供崩溃隔离（SDK 崩溃可检测并重启）。
- 通过 `transport` 抽象预留切换点：默认同进程 worker 调用，需要时切换为子进程调用，对上层接口零改动。

## 4. C SDK 封装层设计

目标：五类复杂度（结构体嵌套、回调、异步、手动内存、内部多线程）全部隔离在 `sdk-service` 内部，对外只暴露 Promise 风格的 TypeScript 接口。

### 4.1 FFI 选型

- 使用 **Koffi**（纯 JS/TS FFI，支持结构体、回调、指针）直接对接 C 接口，避免 C++ 编译链。
- N-API C++ addon 仅在性能实测不达标时考虑。

说明：SDK 仅提供 C 接口，因此 FFI 绑定层由本工程自建；Koffi 为纯 TS 声明，Node 团队可维护。动态库（DLL）为主路径，静态库仅在有 N-API/本地宿主编译需求时使用。

### 4.2 加载与发布

- DLL 通过 electron-builder `extraResources` 打进 `resources/native/`，按 `process.arch` 选择 x64/x86 版本。
- `asarUnpack` 保证原生库可从磁盘加载。
- 启动时校验 DLL 版本与位数；加载失败给出可读错误，不白屏。

### 4.3 接口映射

- 每个 C 结构体在 TS 侧声明 Koffi struct 定义，维护“C 结构体 ↔ TS 接口”对照表。
- 嵌套结构体按层级声明，从 SDK 头文件生成/校对，避免手抄偏移量出错。

### 4.4 回调与异步

- SDK 回调在封装层注册并持有强引用，防止被 GC。
- 回调体只做两件事：数据转可序列化对象、投递到事件队列；SDK 内部多线程触发回调时由封装层编组到安全线程。
- 所有 SDK 调用包装成 Promise；耗时/阻塞调用运行在 worker_threads。
- 回调事件通过统一 `sdk-events` 通道转发（主进程 EventEmitter → IPC → 渲染进程）。
- 同步阻塞类接口严禁在主进程直接调用。

### 4.5 内存管理

- 按头文件明确每条接口的所有权规则（谁分配谁释放）。
- 封装层提供统一 `release()`/`dispose()`，句柄封装为带 `Symbol.dispose` 的对象。
- debug 模式提供泄漏检测（记录未释放句柄）。

### 4.6 错误处理

- SDK 错误码统一翻译为类型化错误：`SdkError { code, category, message, retryable }`。
- 渲染进程只处理业务语义，不接触原始码值。

### 4.7 对外接口形态

```
sdk.init(config) -> Promise<Session>
sdk.open(handle, params) -> Promise<SessionHandle>
sdk.on('event', cb)
sdk.dispose(handle) -> Promise<void>
```

## 5. 数据库与加密

- **引擎**：SQLite + **SQLCipher** 全库加密（AES-256），通过 `better-sqlite3-multiple-ciphers` 接入（用户确认其他项目已在用，作为既定选型）。
- **文件位置**：`app.getPath('userData')/client.db`，只允许主进程打开。
- **密钥管理**：可插拔 `KeyProvider` 接口。
  - 默认：DPAPI + 随机密钥（Electron `safeStorage` 加密存储，用户无感）。
  - 可选：用户口令派生（scrypt/PBKDF2），支持跨机器迁移。
- **数据模型**：
  - `app_config`（key-value，非敏感配置，含 `updated_at`）
  - `secret_config`（key-value，敏感配置，字段级二次加密）
  - `schema_migrations`（版本化迁移）
- **迁移与备份**：启动时自动检测 schema 版本并迁移；支持导出/恢复加密备份（同一密钥）。
- **错误处理**：密钥错误、库损坏给出专门错误码（`DB_KEY_ERROR`、`DB_CORRUPT`），UI 展示可操作提示。

## 6. 网络层（RESTful HTTPS）

- 位置：主进程 `http-client`；渲染进程只发业务意图。
- 技术：基于 Electron `net` 模块（Chromium 网络栈，自动走系统代理、统一 TLS），封装 Promise API（get/post/upload/download），带拦截器、超时、指数退避重试。
- 重试只对幂等请求生效（GET/PUT；POST 需服务端幂等键或人工重试）。
- 鉴权：Token 只存主进程内存，持久化进 `secret_config`；统一 401 处理（刷新后重放，失败才通知 UI 重新登录）。
- 证书：支持导入企业私有 CA 证书（存加密配置）；默认不禁用证书校验。
- 错误分类：`HttpError { kind: network | auth | timeout | server | business, status?, retryable, message }`。
- 日志：debug 模式输出脱敏请求/响应日志（token、密码自动打码）。

## 7. 工程结构与目录布局

脚手架：electron-vite（main / preload / renderer 三目标一套配置），Vue 3 + TypeScript + Pinia + Vue Router。

```
code_reader_client/
├── src/
│   ├── main/              # TypeScript（Node.js/Electron 主进程；sdk-service 默认纯 TS FFI，不引入 C++）
│   │   ├── sdk-service/   # TypeScript（Koffi 声明；如走 N-API 则局部 C++）
│   │   ├── db-service/    # TypeScript
│   │   ├── http-client/   # TypeScript
│   │   ├── use-cases/     # TypeScript
│   │   └── ipc-bridge/    # TypeScript
│   ├── preload/           # TypeScript（编译产物为 CJS JS，供 contextBridge 使用）
│   ├── renderer/          # TypeScript + Vue 3 SFC（HTML/CSS/TS 组件）
│   ├── workers/           # TypeScript（worker_threads 脚本，Node 运行时）
│   └── shared/            # TypeScript（纯类型 + zod schema，主/渲染两侧共享）
├── resources/native/      # C/C++ 编译产物：x64/x86 DLL（二进制，无源码）
├── build/                 # electron-builder 配置 + NSIS 脚本（YAML/JSON/NSIS 方言）
├── tests/                 # TypeScript（Vitest / Playwright）
└── electron-builder.yml   # YAML
```

## 8. 打包与分发

- electron-builder 出 NSIS 安装包，x64 / x86 分别构建。
- DLL 走 `extraResources` + `asarUnpack`。
- per-user 安装（免 UAC，内网易分发），单实例锁。
- 多环境：开发/测试/生产三套配置，API 地址构建注入 + 运行时设置页可改（持久化到加密配置表）。
- 日志：electron-log 写 `userData/logs/`；支持导出诊断包（脱敏）。
- 版本：不做自动更新；打包注入版本号，“关于”页展示；预留可选版本检查接口位。

## 9. 测试策略

- 单元测试（Vitest）：sdk-service 用 mock 桩；db-service 用临时库跑真实迁移与加密读写；http-client 用 mock server 覆盖重试、401 刷新、超时。
- 契约测试：`shared/` IPC 通道参数用 zod 校验，主/渲染两侧跑同一套 schema 测试。
- 集成测试（Playwright for Electron）：核心用户路径（初始化 → 配置 → SDK 调用 → 落库 → 上传）。
- SDK 真机冒烟：真实 DLL 跑最小核心路径（加载 → 建会话 → 回调事件 → 释放），每次发版前必跑。

## 10. 安全清单（验收项）

- 渲染进程：`contextIsolation: true`、`nodeIntegration: false`、严格 CSP。
- HTTPS 证书校验永不关闭；私有 CA 走导入信任流程。
- Token/密钥只存主进程内存 + 加密库，日志全脱敏。
- DLL 加载前做版本/位数校验；资源目录不可写。
- IPC 全部白名单 + zod 参数校验，不开放任意通道。

## 11. 交付风险与 POC 建议

1. C SDK FFI 映射是最大工作量：建议先做最小 POC（挑一个含回调的接口跑通）再全面铺开。
2. `better-sqlite3-multiple-ciphers` 需匹配 Electron ABI（electron-rebuild），是 CI 常见坑。
3. DLL 位数必须与进程架构一致，安装包按架构分。
4. Koffi 在 worker 线程中的回调线程编组细节需 POC 验证（transport 抽象为此预留）。
5. 企业内网代理/证书差异大，需在测试环境提前验证。

## 12. 技术选型清单

| 用途 | 选型 |
|---|---|
| 桌面框架 | Electron |
| 前端 | Vue 3 + TypeScript + Vite（electron-vite） |
| 状态/路由 | Pinia、Vue Router |
| C SDK 接入 | Koffi（纯 TS FFI，必要时 N-API） |
| 数据库 | SQLite + SQLCipher（better-sqlite3-multiple-ciphers） |
| 密钥 | Electron safeStorage（DPAPI），可插拔 KeyProvider |
| 网络 | Electron net 模块封装 |
| 校验 | zod |
| 打包 | electron-builder + NSIS |
| 日志 | electron-log |
| 测试 | Vitest、Playwright |
