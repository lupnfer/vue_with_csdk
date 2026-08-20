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
npm test                # 单元测试（jsdom）
npm run test:integration # 集成测试（需先 electron-vite build）
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
│   │   │   ├── binding.ts            # mock binding（mockBinding 实现）
│   │   │   ├── real-binding.ts       # real binding（HWPuSDK Koffi 声明 + realBinding 实现）
│   │   │   ├── binding-selector.ts   # CRC_SDK_MODE 切换 mock/real
│   │   │   ├── sdk-client.ts         # SdkClient facade（discover + terminate）
│   │   │   ├── errors.ts             # SdkError + 码值翻译
│   │   │   ├── types.ts              # DiscoveredDevice
│   │   │   ├── transport/
│   │   │   │   ├── types.ts          # worker 消息协议类型
│   │   │   │   └── worker-transport.ts  # WorkerTransport + SDK 日志转发到 electron-log
│   │   │   └── workers/
│   │   │       └── sdk.worker.ts     # worker 入口（discover + cleanup）
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
│   │   ├── socket-service/           # 裸报文 UDP 组播（修改 IP，不经 SDK）
│   │   │   ├── udp-multicast.ts      # UdpSocket 接口 + MulticastUdpSocket(dgram) + FakeUdpSocket(桩)
│   │   │   ├── codec.ts              # PacketCodec 接口 + 占位实现（规范到替换）
│   │   │   ├── ip-modify.ts          # IpModifyService（校验+encode+send）
│   │   │   ├── errors.ts             # SocketError + 序列化
│   │   │   └── types.ts              # IpModifyParams/MulticastConfig
│   │   │
│   │   ├── use-cases/                # 业务编排层（串起 sdk/db/http）
│   │   │   ├── services.ts           # ISdkClient/IDbClient/IHttpClient 接口
│   │   │   ├── config-load-auth.ts   # 配置加载与鉴权用例
│   │   │   ├── errors.ts             # UseCaseError + wrapServiceError
│   │   │   └── types.ts              # AppBootstrap
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
│   │           ├── SdkView.vue       # SDK 验证页（搜索设备）
│   │           ├── DbView.vue        # DB 验证页（配置读写）
│   │           ├── HttpView.vue      # HTTP 验证页（请求发送 + 设 Token）
│   │           └── UseCaseView.vue   # UseCase 验证页（配置加载与鉴权）
│   │
│   └── shared/                       # ── 主/渲染共享（IPC 契约）──
│       └── ipc/
│           ├── channels.ts           # 全部 IPC 通道名 + zod schema
│           ├── api.ts                # RendererApi 接口（渲染可见 API 类型）
│           └── validate.ts           # 通用 zod 校验工具
│
└── tests/                            # ── 测试（Vitest）──
    ├── main/                         # 主进程单测（security）
    ├── sdk/                          # SDK 集成测试（需构建 worker）
    ├── db/                           # DB 测试（需 better-sqlite3 native）
    ├── http/                         # HTTP 单测（FakeTransport 驱动）
    ├── socket/                       # 裸报文单测（FakeUdpSocket 驱动）
    ├── use-cases/                    # UseCase 测试（服务桩驱动 + stubs.ts）
    └── renderer/                     # 渲染组件测试（jsdom）
```

## Windows 构建与打包（仅 Windows x64）

### 构建流程概述

```
npm install
  → 依赖安装（better-sqlite3 默认编译成 Node ABI）
  → 不跑 postinstall（不自动 rebuild）

npm run rebuild:electron
  → @electron/rebuild 把 better-sqlite3-multiple-ciphers 重新编译成 Electron x64 ABI
  → koffi 不需要 rebuild（预编译多平台二进制）
  → 此后 Electron 能加载 native 模块，但 vitest 不能（ABI 不匹配）

npm run build -- --mode=production
  → electron-vite 构建 main/preload/renderer 三目标 → out/

electron-builder --win --x64
  → 打包 out/ + node_modules → asar
  → extraResources: HWPuSDK.dll / IVS_PU_Player.dll / 证书 → resources/native/
  → asarUnpack: better-sqlite3 / koffi 的 .node 从 asar 解出
  → NSIS 安装包 → release/
```

### 前置准备

1. **Windows x64 机器**，装好 Node.js >= 22.12
2. **Visual Studio Build Tools**（C++ 编译环境，rebuild 需要）
3. **证书文件**放在 `c_sdk_lib/x64/cert/`：
   ```
   c_sdk_lib/x64/cert/
   ├── cacert.cer    # CA 证书（从 SDK 发布包 sdk/windows/lib/cert/ 复制）
   ├── cert.pem      # 客户端证书
   └── key.pem       # 客户端私钥
   ```
   密码：`715AO1FEC11AD58A`（默认证书固定密码，已写在 real-binding.ts 的 SdkInitConfig）
4. **DLL 文件**在 `c_sdk_lib/x64/`：`HWPuSDK.dll` + `IVS_PU_Player.dll`
5. **应用图标**（可选）：放 `build/icon.ico`，不提供则用默认 Electron 图标

### 打包命令

```bash
# 方式 1：一键打包（推荐）
npm install
npm run dist:win
# dist:win = rebuild:electron + build --mode=production + electron-builder --win --x64

# 方式 2：分步执行（调试用）
npm install
npm run rebuild:electron       # 编译 native 模块为 Electron ABI
npm run build -- --mode=production  # electron-vite 构建
npx electron-builder --win --x64    # 打包 NSIS
```

### 产出

```
release/
├── Code Reader Client Setup 0.1.0.exe   # NSIS 安装包（per-user，免 UAC）
└── win-unpacked/                         # 免安装解压版
    ├── Code Reader Client.exe            # 启动器
    ├── resources/
    │   ├── app.asar                      # 应用代码（main/preload/renderer）
    │   ├── app.asar.unpacked/            # native 模块（better-sqlite3 / koffi .node）
    │   └── native/
    │       ├── HWPuSDK.dll              # 真实 C SDK
    │       ├── IVS_PU_Player.dll         # 播放器 DLL
    │       └── cert/                    # 证书
    │           ├── cacert.cer
    │           ├── cert.pem
    │           └── key.pem
    └── ...
```

### 安装包内容说明

| 内容 | 来源 | 打包方式 | 运行时路径 |
|---|---|---|---|
| Electron + 应用代码 | electron-vite build → `out/` | asar 打包 | `resources/app.asar` |
| HWPuSDK.dll + IVS_PU_Player.dll | `c_sdk_lib/x64/` | extraResources | `resources/native/` |
| 证书（cacert.cer/cert.pem/key.pem） | `c_sdk_lib/x64/cert/` | extraResources | `resources/native/cert/` |
| better-sqlite3 .node | node_modules | asarUnpack | `resources/app.asar.unpacked/` |
| koffi .node | node_modules | asarUnpack | `resources/app.asar.unpacked/` |

### 安装后运行

- **per-user 安装**（免 UAC）：装到 `%LOCALAPPDATA%\Programs\Code Reader Client\`
- 桌面快捷方式 / 开始菜单启动
- 默认 `CRC_SDK_MODE` 未设 → 走 mock binding（不需要真实 DLL 也能启动 UI）
- 要用真实 SDK：设环境变量后启动：
  ```cmd
  set CRC_SDK_MODE=real
  "Code Reader Client.exe"
  ```
- 日志文件：`%APPDATA%\Code Reader Client\logs\main.log`（electron-log，10MB 轮转）

### 验证真实 SDK 功能

设 `CRC_SDK_MODE=real` 启动后：
1. 打开 **SDK POC** 页
2. 点"搜索局域网设备" → 应返回局域网内的 SDC/摄像机列表（MAC/IP/型号/SN 等）
3. 日志在 `%APPDATA%\Code Reader Client\logs\main.log` 查看 SDK 日志输出

### ABI 说明

| 组件 | ABI | 说明 |
|---|---|---|
| better-sqlite3-multiple-ciphers | rebuild 前为 Node ABI，rebuild 后为 Electron ABI | `npm install` 默认编译成 Node ABI；`rebuild:electron` 改为 Electron ABI |
| koffi | 预编译多平台 | 不受 ABI 影响，Node 和 Electron 都能加载 |
| HWPuSDK.dll | Windows x64 | 固定，不受 Node/Electron 版本影响 |

> **macOS 开发机**：不需要 rebuild（不跑 Electron）。用 `npm test` 跑测试（Node ABI），`npm run dev` 需要 Electron 二进制。
> **vitest 与 rebuild 的矛盾**：rebuild 后 vitest 无法加载 better-sqlite3（ABI 不匹配）。macOS 开发时不 rebuild，保持 Node ABI；Windows 打包时 rebuild，不跑 vitest。
