# C SDK 封装层（sdk-service）架构验证 POC 设计

- 日期：2026-08-12
- 状态：待审阅
- 需求来源：`docs/superpowers/specs/2026-08-11-code-reader-client-design.md` §4、§11
- 上游产物：子计划 1/6（工程脚手架，已合并到 main）
- 范围：子计划 2/6

## 1. 背景与目标

设计文档 §11 把 C SDK FFI 映射列为最大工作量与最大风险，并建议先做最小 POC 再全面铺开；其中风险 #4（Koffi 在 worker 线程中的回调线程编组细节）无法靠静态分析确认，必须实测。

本子计划目标：**用一个自写的 mock C 库验证 sdk-service 的端到端架构**，覆盖 §1 列出的 C SDK 五类复杂度（结构体嵌套、回调、异步、手动内存、内部多线程），并跑通一条"初始化 → 打开 → 异步回调事件 → 释放"的完整路径，经 IPC 暴露到渲染进程可点击验证。

**约束确认：**
- C SDK 尚未到手，本计划用自写的 mock C 库（真实编译的共享库）做架构验证；真实 SDK 到手后替换 `binding.ts` 指向 `resources/native/`，封装层零改动。
- 交付边界：骨架 + 一条端到端路径。全量 SDK 接口映射、`utilityProcess` 崩溃隔离留到后续子计划；transport 抽象仅预留切换点。
- 进程模型：worker_threads 为默认承载（§3.2），不在主进程直跑 C SDK（§3.1）。

## 2. 方案选择

采用 **worker_threads 优先 + transport 抽象**（方案 A）。

| 方案 | 是否验证核心风险 | 是否匹配默认模型 | 结论 |
|---|---|---|---|
| A. worker_threads + transport 抽象 | ✅ 验证回调线程编组（§11 #4） | ✅ §3.2 默认 | 采用 |
| B. 主进程直跑 | ❌ 不触及 worker 回调编组，且违反 §3.1 | ❌ | 否决 |
| C. utilityProcess 优先 | ⚠️ 验证崩溃隔离而非编组 | ❌ §3.2 定为可选增强 | 作为第二步，不在本计划 |

理由：只有方案 A 真正攻击 POC 存在的核心风险，同时匹配设计文档默认模型，并把 `utilityProcess` 留成干净的将来切换点。

## 3. mock C 库设计

自写的"假扫描器会话"库，模拟五类复杂度但保持 POC 级别小（6 个函数）。源码与编译产物均在仓库内。

### 3.1 接口

```c
// 嵌套结构体（验证结构体映射）
typedef struct {
    int level;
    char prefix[64];
} logger_config;

typedef struct {
    int mode;
    logger_config logger;   // 嵌套
} sdk_config;

// 回调 typedef（验证回调注册 + 线程编组）
typedef void (*scan_callback)(int event_type, const char *payload, void *user_data);

// 句柄与参数
typedef struct sdk_session sdk_session;      // 不透明
typedef struct sdk_handle   sdk_handle;      // 不透明

typedef struct {
    scan_callback cb;
    void *user_data;
} open_params;

// 6 个函数
sdk_session* crc_sdk_init(const sdk_config *config);
sdk_handle*  crc_sdk_open(sdk_session *session, const open_params *params);
int          crc_sdk_start_scan(sdk_handle *handle);   // 立即返回 0；结果走回调（异步、内部线程）
int          crc_sdk_release(sdk_handle *handle);
int          crc_sdk_close(sdk_session *session);
const char*  crc_sdk_version(void);
```

### 3.2 行为

- `crc_sdk_init`：分配 session，返回不透明指针；校验 config，非法返回 NULL。
- `crc_sdk_open`：分配 handle，登记回调指针；返回不透明指针。
- `crc_sdk_start_scan`：立即返回 0（成功排队）；**内部 `pthread_create` 一个工作线程**，延迟若干毫秒后在该线程上调用注册的 `scan_callback`，投递 1-2 个事件（event_type + JSON 字符串 payload）。验证异步 + 内部多线程 + 回调线程编组。
- `crc_sdk_release` / `crc_sdk_close`：释放句柄；release 前先取消该 handle 的回调；重复释放返回非 0 错误码（幂等检测）。
- `crc_sdk_version`：返回静态字符串，用于加载时版本校验。

### 3.3 所有权规则（§4.5）

- `init` 分配 session，`open` 分配 handle，均由调用方显式 `release` / `close`。
- 回调指针随 handle 注册，`release(handle)` 时 C 侧先取消回调再释放内存；`close(session)` 清空该 session 下所有回调引用。

### 3.4 构建与布局

```
mock-sdk/
├── c/
│   ├── crc_sdk.h
│   ├── crc_sdk.c          # pthread 异步触发回调
│   └── Makefile           # clang -shared -fPIC
└── build/                 # gitignored；产物 .dylib(macOS) / .dll(后续)
```

- 编译：`clang -shared -fPIC -o build/libcrc_sdk.<ext> c/crc_sdk.c`（macOS 用 Xcode CLT 自带 clang，零额外工具链）。
- 不引入 CMake；Windows `.dll` 交叉编译放到打包子计划。
- 产物路径：优先读环境变量 `CRC_MOCK_SDK_PATH`，未设则回退约定路径 `mock-sdk/build/libcrc_sdk.<ext>`。
- `mock-sdk/` 独立于 `resources/native/`（真实 SDK 位置），不混入。

## 4. 封装层与 transport 架构

### 4.1 模块结构

```
src/main/sdk-service/
├── transport/
│   ├── types.ts                  # Transport 接口
│   ├── worker-transport.ts       # 默认实现：worker_threads + MessagePort
│   └── (utility-process-transport.ts  # 接口位，不实现)
├── binding.ts                    # Koffi 声明：struct/函数/回调 typedef
├── sdk-client.ts                 # Promise 封装 + 回调强引用 + 事件转发
├── errors.ts                     # SdkError 翻译
├── types.ts                      # 对外 TS 接口（Session/Handle/事件，无 C 指针）
└── workers/
    └── sdk.worker.ts             # worker 入口：加载 DLL、跑 Koffi、回调投递回主进程
```

### 4.2 Transport 接口

```ts
interface Transport {
  invoke<T>(method: string, args: unknown[]): Promise<T>;
  on(event: 'data', cb: (payload: unknown) => void): void;   // 编组后的事件
  on(event: 'error', cb: (err: SdkError) => void): void;
  terminate(): void;
}
```

- 上层 `SdkClient` 永远只调 `Transport.invoke`，不直接碰 worker。
- 将来切 `utilityProcess` 只换 transport 实现，上层零改动（§3.2 预留点）。
- **命名约定**：`Transport.invoke(method, args)` 的 `method` 是 worker 内部短名（`init`/`open`/`start`/`release`/`close`），与 IPC 通道名（`sdk:init` 等，§8.2）是两套命名、不必相同——IPC 通道名面向渲染契约，method 名面向 worker 路由。

### 4.3 数据流（端到端路径）

1. 渲染进程调 `window.api.sdk.init(config)` → IPC `sdk:init`
2. 主进程 `SdkClient.init` → `Transport.invoke('init', [config])` → worker
3. worker 内 Koffi 调 `crc_sdk_init`，拿回 session 指针 → **指针转不透明 id**（序列化友好）回主进程
4. 渲染只拿到 `Session`（id），不接触原始指针
5. `startScan` 触发后，C 库内部线程回调 → worker 把回调数据转可序列化对象 → `MessagePort.postMessage` → 主进程 `EventEmitter` → IPC `sdk-events` → 渲染 `sdk.on('event', cb)`

### 4.4 关键决策

- **指针不跨进程序列化**：worker 内维护 `id ↔ 指针` 映射表（`Map<id, ptr>`），主进程/渲染只看到 id。同时满足 §4.5（指针只在 worker 内释放）与 §3.1（渲染纯净）。
- **transport.invoke 是唯一调用入口**：上层不直接碰 worker（§3.2 切换点）。
- **回调强引用在 sdk-client 持有**（§4.4）：worker 侧只做转发不持有 JS 回调，避免跨线程 GC 问题。
- **回调体只做两件事**（§4.4）：数据转可序列化对象、投递到事件队列；C 内部多线程触发回调时由封装层编组到安全线程。

## 5. 错误处理（§4.6）

- C 返回码 / 异常统一翻译为类型化 `SdkError`：
  ```
  SdkError { code: string, category: 'init'|'call'|'callback'|'memory'|'unknown', message: string, retryable: boolean }
  ```
- `code` 是工程自定义稳定字符串（如 `SDK_INIT_FAILED`、`SDK_CALLBACK_GONE`、`SDK_ALREADY_RELEASED`），不是裸 int；渲染进程只处理业务语义。
- worker 侧：C 调用失败时把码值 + 原始信息打包成可序列化错误对象，经 `MessagePort` 投回；主进程 `worker-transport` 重建为 `SdkError` 抛出。
- 参数非法 / 校验失败归入 `category: 'call'`，`retryable: false`。

## 6. 内存管理（§4.5）

- worker 内 `id ↔ 指针` 注册表（`Map<id, ptr>`），C 句柄生命周期在 worker 内闭环：
  - `init` / `open`：分配 id，登记指针
  - `release` / `close`：取指针 → 调 C 释放 → 删除登记
- `SdkClient` 暴露 `dispose(handle)` / `disposeSession(session)`，内部即 `invoke('release', [id])`。
- **泄漏检测（debug 模式）**：worker 退出 / `closeAll` 时扫描注册表，未释放条目输出告警日志（id + 类型）；POC 阶段打日志即可，不硬失败。
- 回调生命周期：随 handle 注册，`release(handle)` 时 C 侧先取消回调再释放；`close(session)` 清空该 session 下所有回调引用。

## 7. 测试策略（§9 适配）

### 7.1 单元测试（Vitest）
- `errors.ts`：码值 → `SdkError` 翻译表全覆盖（每类至少一个）。
- `binding.ts` / `sdk-client.ts` / `worker-transport.ts`：依赖真实 C 库或 worker 运行时，归入集成测试，不做 mock 桩单测。

### 7.2 集成测试（Vitest，跑真实 mock C 库）—— POC 核心验证
`tests/sdk/` 下：
- **加载与生命周期**：init → open → start → release → close 全程无异常；重复 release 幂等（返回已释放错误，不崩）。
- **异步回调**：startScan 后在合理超时内收到回调事件，数据与预期一致。
- **回调线程编组**（§11 #4 核心）：回调确实来自 C 库内部线程（线程 id 与 worker 主线程不同），经 transport 编组后安全到达主进程 EventEmitter，且不阻塞 worker 事件循环。
- **内存泄漏检测**：debug 模式下正常 release 全部句柄后注册表为空；故意不 release 时有告警日志。
- **错误传播**：C 返回错误码时主进程拿到 `SdkError`，category/message 正确。

### 7.3 端到端（IPC → 渲染）
- 不开真实 Electron 窗口（POC 重）；用集成测试模拟 `ipcMain`/`ipcRenderer` 或直接测主进程 handler + preload 契约，验证 `window.api.sdk.*` 的 Promise 与事件链路通。
- 真实窗口手动冒烟作为可选步骤（有显示环境时）。

### 7.4 契约测试
- IPC 通道（`sdk:init` / `sdk:open` / `sdk:start-scan` / `sdk:dispose` / `sdk-events`）参数走 zod schema，沿用子计划 1 的 `src/shared/ipc/` 模式。

### 7.5 前置依赖
- mock C 库必须先编译出 `.dylib` 才能跑集成测试；`make` 作为测试前置步骤（`npm run build:mock` 或测试脚本内联触发）。

## 8. 与现有工程集成

### 8.1 worker 构建（electron-vite）
- `src/main/workers/sdk.worker.ts` 为 Node 运行时脚本，需单独构建目标。
- 在 `electron.vite.config.ts` 的 `main` 配置加 `build.rollupOptions.input`，把 worker 作为额外入口，产出 `out/main/workers/sdk.worker.js`。
- worker 加载：`new Worker(path.join(__dirname, 'workers/sdk.worker.js'))`。

### 8.2 IPC 与渲染集成（沿用子计划 1 契约模式）
- `src/shared/ipc/channels.ts` 扩展：加 `sdk.init` / `sdk.open` / `sdk.start-scan` / `sdk.dispose` / `sdk-events`（事件用 `webContents.send` 推送）+ zod schema。
- `src/shared/ipc/api.ts` 扩展 `RendererApi`：加 `sdk: { init, open, startScan, dispose, on(event, cb) }`。
- `src/preload/index.ts` 暴露 `window.api.sdk.*`；事件用 `ipcRenderer.on('sdk-events')` 转成 `on('event', cb)` 订阅。
- `src/main/ipc/register.ts` 注册 sdk handler，内部调 `SdkClient`（经 transport）。

### 8.3 渲染进程验证页
- `HomeView` 旁加 `SdkView`（路由 `/sdk`）：一个按钮触发 init → open → startScan，展示收到的回调事件列表，用于手动冒烟端到端路径。

### 8.4 配置补充
- `vitest.config.ts`：加 `exclude: ['.worktrees/**']`，顺手修掉子计划 1 遗留的测试重复计数问题；集成测试前置 `make` 由 `npm run build:mock` 触发。

## 9. 交付清单（本子计划产出）

- `mock-sdk/c/crc_sdk.{h,c}` + `Makefile` —— mock C 库
- `src/main/sdk-service/` —— 封装层（transport/binding/sdk-client/errors/types）
- `src/main/workers/sdk.worker.ts` —— worker 入口
- `src/main/ipc/register.ts` 扩展 —— sdk handler
- `src/shared/ipc/{channels,api}.ts` 扩展 —— sdk 契约
- `src/preload/index.ts` 扩展 —— `window.api.sdk`
- `src/renderer/src/views/SdkView.vue` + 路由 —— 验证页
- `tests/sdk/` —— 集成测试
- `package.json` 加 `build:mock` 脚本
- `electron.vite.config.ts` 加 worker 构建目标
- `vitest.config.ts` 加 `.worktrees/**` exclude

## 10. 验收标准

- `npm run build:mock` 成功产出 `.dylib`。
- `npm run typecheck`、`npm test`（含集成测试）、`npm run build` 全绿。
- 集成测试覆盖 §7.2 五项；回调线程编组（§11 #4）实测通过。
- 端到端路径：渲染页点击按钮 → 收到回调事件列表（手动冒烟，可选）。
- 内存泄漏检测：debug 模式下正常 release 全部句柄后，泄漏检测日志为空。
- transport 抽象就位：`utilityProcess` 切换点预留但未实现，上层接口零耦合。
- 真实 SDK 到手后只需改 `binding.ts` 指向 `resources/native/`，封装层其余部分不动。

## 11. 已知限制（POC 范围外，真实 SDK 接入前需处理）

1. **`disposeSession` 不追踪 session→handle 所有权。** worker 的 `close` 只删 session 注册表项，不释放该 session 下仍打开的 handle / 不注销其 koffi 回调。调用方必须先 `dispose` 所有 handle 再 `disposeSession`（`closeAll` 是兜底清理，但未暴露给渲染）。真实 SDK 接入时需按其所有权规则补 session→handle 映射或在 `close` 时拒绝仍有 handle 的 session。
2. **detached 回调线程 vs release 的竞态仅靠时序规避。** mock 用 `PTHREAD_CREATE_DETACHED` 线程投递回调，`scan_thread_arg` 独立分配（线程不再访问 handle 内存，这点安全）；但 `release` 会 `unregisterCallback(regId)` 释放 koffi trampoline，若该线程仍在 trampoline 中执行则 use-after-free。POC 靠 mock 的确定性时序（回调 50ms 内完成）+ 测试/页面的显式等待规避。**真实 SDK 契约必须保证 `release` 返回后不再触发回调**（或提供 join/cancel API），否则需在封装层加 grace period 或延迟注销。
3. **`closeAll` 的 leak 事件与 scan 事件共用 `sdk-events` 通道且类型不一。** `EventMessage.data: unknown`，`SdkClient.on('event')` 把所有事件当 `SdkEvent`（类型不精确）。当前 `closeAll` 未暴露给渲染，无害；若暴露需做判别联合或独立通道。

