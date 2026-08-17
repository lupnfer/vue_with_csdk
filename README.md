# Code Reader Client

Vue 3 桌面客户端（Electron），CS 架构：RESTful 与外部服务端交互，C SDK 本地执行，SQLCipher 加密配置库。

## 环境要求

- Node.js >= 22.12

## 开发

```bash
npm install
npm run dev
```

## 构建与类型检查

```bash
npm run typecheck
npm run build
```

## 测试

```bash
npm test                # 单元测试（jsdom，不含 native 集成）
npm run test:integration # 集成测试（需先 build mock C 库 + electron-vite build）
npm run test:all         # 单元 + 集成
```

## 目录结构

```
code_reader_client/
│
├── package.json                      # 工程元信息、脚本、依赖
├── electron-builder.yml              # electron-builder 打包配置（NSIS, Windows x64）
├── electron.vite.config.ts           # electron-vite 三目标构建（main/preload/renderer + worker 入口）
├── tsconfig.json / .node.json / .web.json  # TypeScript 配置
├── vitest.config.ts                  # 单元测试配置（jsdom，排除 sdk 集成测试）
├── vitest.config.integration.ts      # 集成测试配置（node 环境，仅 tests/sdk/**）
│
├── build/                            # electron-builder 资源目录（icon.ico 占位）
│
├── mock-sdk/                         # mock C 库（模拟 HWPuSDK，macOS 测试用）
│   └── c/
│       ├── crc_sdk.h                 # mock 头文件（嵌套结构体/回调/不透明句柄/6 个函数）
│       ├── crc_sdk.c                 # mock 实现（pthread 异步回调）
│       └── Makefile                  # clang 编译 mock dylib
│
├── c_sdk_lib/                        # 真实 HWPuSDK（Windows x64，未跟踪 git）
│   └── x64/
│       ├── HWPuSDK.dll / .h / .lib   # 真实 SDK
│       └── cert/                     # 证书目录（cacert.cer / cert.pem / key.pem）
│
├── docs/                             # 设计文档与实施计划
│   ├── specs/                        # 各子计划的设计 spec
│   ├── plans/                        # 各子计划的分步实施计划
│   └── require.md                    # 原始需求文档 + 框架选型对比
│
├── src/
│   ├── main/                         # ── 主进程 ──
│   │   ├── index.ts                  # 入口：窗口、CSP、单实例锁、electron-log、before-quit 关库/SDK
│   │   ├── security.ts               # WebPreferences + CSP 策略
│   │   │
│   │   ├── sdk-service/              # C SDK 封装（Koffi FFI + worker_threads）
│   │   │   ├── binding-interface.ts  # SdkBinding 统一接口
│   │   │   ├── binding.ts            # mock binding（Koffi 声明 + mockBinding 实现）
│   │   │   ├── real-binding.ts       # real binding（HWPuSDK Koffi 声明 + realBinding 实现）
│   │   │   ├── binding-selector.ts   # CRC_SDK_MODE 切换 mock/real
│   │   │   ├── sdk-client.ts         # SdkClient facade（Promise + 事件 + discover）
│   │   │   ├── errors.ts             # SdkError + 码值翻译
│   │   │   ├── types.ts              # Session/Handle/SdkConfig/SdkEvent/DiscoveredDevice
│   │   │   ├── transport/
│   │   │   │   ├── types.ts          # worker 消息协议类型
│   │   │   │   └── worker-transport.ts  # WorkerTransport + SDK 日志转发到 electron-log
│   │   │   └── workers/
│   │   │       └── sdk.worker.ts     # worker 入口（Koffi 调用 + 回调投递 + id↔ptr 注册表）
│   │   │
│   │   ├── db-service/               # 加密配置库（SQLCipher + 字段加密）
│   │   │   ├── db-client.ts          # DbClient facade（open/CRUD/close）
│   │   │   ├── db.ts                 # openEncryptedDb（密钥验证）
│   │   │   ├── errors.ts             # DbError + SQLITE 码翻译
│   │   │   ├── field-cipher.ts       # AES-256-GCM 字段级加解密
│   │   │   ├── key-provider.ts       # KeyProvider（SafeStorage + Static 测试桩）
│   │   │   ├── migrations.ts         # schema 版本检测 + 迁移（建三表）
│   │   │   ├── repositories.ts       # app_config/secret_config CRUD
│   │   │   └── types.ts              # ConfigEntry
│   │   │
│   │   ├── http-client/              # HTTPS 网络层（Electron net + 重试 + 401 刷新）
│   │   │   ├── http-client.ts        # HttpClient facade（重试/401 刷新/single-flight）
│   │   │   ├── http-error.ts         # HttpError 五类 + redactHeaders 脱敏
│   │   │   ├── transport.ts          # HttpTransport + NetTransport + FakeTransport
│   │   │   ├── token-store.ts        # TokenStore（Db + InMemory）
│   │   │   ├── config.ts             # HttpConfig + DbHttpConfig
│   │   │   └── types.ts              # RequestOptions/TypedResponse
│   │   │
│   │   ├── use-cases/                # 业务编排层（串起 sdk/db/http）
│   │   │   ├── services.ts           # ISdkClient/IDbClient/IHttpClient 接口
│   │   │   ├── scan-and-upload.ts    # 扫描并上传用例
│   │   │   ├── config-load-auth.ts   # 配置加载与鉴权用例
│   │   │   ├── errors.ts             # UseCaseError + wrapServiceError
│   │   │   └── types.ts              # ScanParams/ScanResult/AppBootstrap
│   │   │
│   │   └── ipc/
│   │       └── register.ts           # IPC handler 注册（全通道 + 错误序列化 + getDbClient）
│   │
│   ├── preload/
│   │   └── index.ts                  # contextBridge 白名单 API（window.api.sdk/db/http/useCase）
│   │
│   ├── renderer/                     # ── 渲染进程（Vue 3 SPA）──
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.ts               # Vue 应用装配（Pinia + Router）
│   │       ├── App.vue               # 根组件
│   │       ├── router.ts             # hash 路由（/ /sdk /db /http /use-case）
│   │       ├── env.d.ts              # window.api 类型声明
│   │       ├── stores/app.ts         # Pinia store（应用版本）
│   │       └── views/
│   │           ├── HomeView.vue      # 首页（版本 + POC 入口链接）
│   │           ├── SdkView.vue       # SDK 验证页（扫描 + 搜索设备）
│   │           ├── DbView.vue        # DB 验证页（配置读写）
│   │           ├── HttpView.vue      # HTTP 验证页（请求发送 + 设 Token）
│   │           └── UseCaseView.vue   # UseCase 验证页（配置加载 + 扫描上传）
│   │
│   └── shared/                       # ── 主/渲染共享（IPC 契约）──
│       └── ipc/
│           ├── channels.ts           # 全部 IPC 通道名 + zod schema
│           ├── api.ts                # RendererApi 接口（渲染可见 API 类型）
│           └── validate.ts           # 通用 zod 校验工具
│
└── tests/                            # ── 测试（Vitest）──
    ├── main/                         # 主进程单测（security/errors）
    ├── sdk/                          # SDK 集成测试（需 mock dylib + 构建 worker）
    ├── db/                           # DB 测试（需 better-sqlite3 native）
    ├── http/                         # HTTP 单测（FakeTransport 驱动）
    ├── use-cases/                    # UseCase 测试（服务桩驱动 + stubs.ts）
    ├── renderer/                     # 渲染组件测试（jsdom）
    └── shared/ipc/                   # IPC 契约测试（zod schema 校验）
```

## Windows 打包（Windows 环境）

1. 确保证书文件在 `c_sdk_lib/x64/cert/`（`cacert.cer`、`cert.pem`、`key.pem`）
2. `npm install`
3. `npm run rebuild:electron`（把 native 模块编译成 Electron ABI）
4. `npm run dist:win`（一键打包：rebuild → build → electron-builder NSIS）
5. 产出 `release/` 目录下的 NSIS 安装包

> macOS 开发机不可跑 `rebuild:electron`（需 Windows 编译环境）。
> 测试在 macOS 用 `npm test`（Node ABI，不需 rebuild）。
