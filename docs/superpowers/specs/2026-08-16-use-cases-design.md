# 业务编排层（use-cases）设计

- 日期：2026-08-16
- 状态：待审阅
- 需求来源：`docs/superpowers/specs/2026-08-11-code-reader-client-design.md` §3.1（业务编排）
- 上游产物：子计划 1/6（脚手架）、2/6（sdk-service）、3/6（db-service）、4/6（http-client），均已合并到 main
- 范围：子计划 5/6

## 1. 背景与目标

设计文档 §3.1 规定新增 use-cases 层，将 sdk-service / db-service / http-client 串成业务动作，数据流单向：UI → use-case → (sdk / db / http)。

本子计划目标：**建立业务编排层骨架 + 2 个代表性用例**，验证跨三服务编排架构。

**约束确认：**
- 交付 2 个代表性用例：扫描并上传（跨三服务，异步事件 + 状态）+ 配置加载与鉴权（启动初始化编排）。
- use-cases 是纯主进程库（不经自己的 IPC，由 register.ts handler 调）。
- 测试注入服务桩（FakeSdkClient/InMemoryDbClient/FakeHttpClient），不碰真实 worker/db/net。
- 三个 facade 抽接口（ISdkClient/IDbClient/IHttpClient），use-case 只依赖接口，可测可替换。
- 错误处理：两个用例都"每步错误直接抛"（不分容错），包成 UseCaseError（带 category + cause）。scan-and-upload 的 finally 清理是资源管理，与错误策略无关。
- 不在 5/6 做：真实服务集成（推迟 6/6 Electron 冲烟）、UI 进度回调、用例重试策略。

## 2. 方案选择

采用 **Services 元组 + use-case 类（接口驱动）**（方案 A）。

| 方案 | 说明 | 结论 |
|---|---|---|
| A. Services 元组 + use-case 类（接口驱动） | 每个用例接收 `{ sdk, db, http }`（基于接口）；测试注入桩；不导入具体类 | 采用 |
| B. use-case 直接 import 单例 | 与具体实现强耦合，测试需 mock 整个模块，违背"可单测" | 否决 |
| C. 函数式 use-case | 状态管理难（扫描有异步事件 + 进度），POC 反而复杂 | 否决 |

理由：方案 A 符合 §3.1"每个模块独立、可单测"和单向数据流；测试注入桩即可跑完整编排逻辑；状态封装在类里，适合多步骤异步用例。

## 3. 模块结构

```
src/main/use-cases/
├── services.ts              # ISdkClient/IDbClient/IHttpClient/Services 接口
├── scan-and-upload.ts        # ScanAndUploadUseCase（跨三服务，异步事件 + 状态）
├── config-load-auth.ts       # ConfigLoadAuthUseCase（启动初始化编排）
├── errors.ts                 # UseCaseError（包装三服务错误，统一 category）
└── types.ts                  # 对外 TS 类型（ScanParams/ScanResult/AppBootstrap）

src/main/sdk-service/sdk-client.ts（修改）  # implements ISdkClient
src/main/db-service/db-client.ts（修改）    # implements IDbClient
src/main/http-client/http-client.ts（修改） # implements IHttpClient
src/main/ipc/register.ts（修改）            # 接入 use-case
src/renderer/src/views/UseCaseView.vue + router /use-case  # 验证页
tests/use-cases/*.test.ts                   # 单测（服务桩驱动）
```

### 关键决策

- **use-case 是纯主进程库**，不经自己的 IPC（由 register.ts 现有或新 handler 调）。渲染调 `window.api.sdk/db/http` 触发，或加一个 `use-case:scan-and-upload` 通道让渲染直接调 execute。
- **use-case 只依赖接口**，测试注入桩，不碰真实 worker/db/net。
- **不进 worker**：use-case 是编排逻辑，主进程直跑。
- **errors.ts 统一包装**：三服务各有自己的 Error，use-case 捕获后包成 UseCaseError。

## 4. 服务接口抽象

```ts
// src/main/use-cases/services.ts
export interface ISdkClient {
  init(config: SdkConfig): Promise<Session>
  open(session: Session): Promise<Handle>
  startScan(handle: Handle): Promise<void>
  dispose(handle: Handle): Promise<void>
  disposeSession(session: Session): Promise<void>
  on(event: 'event', cb: (e: SdkEvent) => void): void
}

export interface IDbClient {
  getAppConfig(key: string): string | null
  setAppConfig(key: string, value: string): void
  getSecretConfig(key: string): string | null
  setSecretConfig(key: string, value: string): void
}

export interface IHttpClient {
  get<T = unknown>(path: string, opts?: RequestOptions): Promise<TypedResponse<T>>
  post<T = unknown>(path: string, opts?: RequestOptions): Promise<TypedResponse<T>>
  tokens: TokenStore
}

export interface Services {
  sdk: ISdkClient
  db: IDbClient
  http: IHttpClient
}
```

现有 SdkClient/DbClient/HttpClient 用 `implements` 标注这三个接口（结构化类型已兼容，显式标注让依赖明确 + 防漂移）。DbClient 是同步方法（子计划 3 既定），接口也用同步签名。

## 5. ScanAndUploadUseCase（跨三服务）

### 5.1 业务动作

sdk 初始化 → 打开会话 → 启动扫描 → 收集回调事件 → 扫描结果落 db → http 上传结果。

```ts
// src/main/use-cases/types.ts
export interface ScanParams {
  sdkConfig: SdkConfig
  uploadUrl: string   // http 上传地址（path，http 拼 baseUrl）
}

export interface ScanResult {
  sessionId: number
  handleId: number
  events: SdkEvent[]
  uploaded: boolean
  uploadResponse?: unknown
}
```

### 5.2 execute() 编排流程

```
execute(params: ScanParams): Promise<ScanResult>
  ├ 1. sdk.init(params.sdkConfig) → session
  ├ 2. sdk.open(session) → handle
  ├ 3. 注册事件收集：sdk.on('event', e => events.push(e))
  ├ 4. sdk.startScan(handle)  // 立即返回，回调异步到达
  ├ 5. 等待回调完成（轮询 events 数量到预期，或超时；POC 预期 2 个事件 started+done）
  ├ 6. db.setAppConfig('last_scan', JSON.stringify(events))  // 扫描记录落库
  ├ 7. http.post(params.uploadUrl, { body: { sessionId, events } })  // 上传结果
  ├ 8. sdk.dispose(handle) + sdk.disposeSession(session)  // 清理
  └ 9. 返回 ScanResult
```

### 5.3 错误处理

- 任一服务抛错（SdkError/DbError/HttpError）→ 捕获 → 包成 UseCaseError，**仍尝试清理**（dispose handle/session，防泄漏）→ 再抛。
- 上传失败（http 抛）→ 抛 UseCaseError（上层决定是否重试），扫描结果已落 db 不丢。
- 事件超时 → 抛 UseCaseError(category=orchestration)。

### 5.4 状态与异步

- events 收集是异步的（sdk 回调在 worker 线程触发，经 transport 编组到主进程 EventEmitter）。
- "等待回调完成"：POC 用轮询 + 超时（预期 2 个事件，超时 3s）。真实 SDK 可能没有固定事件数——届时改为"等 done 事件或超时"。
- **不暴露中间进度给 UI**（POC）：execute 是一次性 Promise。将来加 onProgress 回调。

### 5.5 关键决策

- 顺序明确：init→open→collect→start→wait→db→http→cleanup。每步失败都进 catch + 清理。
- db 落的是扫描记录（app_config，非敏感），验证 sdk↔db 编排。
- http 上传用 post（非幂等，不重试——符合 §6）。
- 清理在 finally：无论成功失败都 dispose，防句柄泄漏。

## 6. ConfigLoadAuthUseCase（启动初始化）

### 6.1 业务动作

启动时 db 读配置 → http.setToken（从 db secret_config 取 token）→ sdk.init（用配置驱动）。

```ts
// src/main/use-cases/types.ts（追加）
export interface AppBootstrap {
  sdkSession?: Session   // 成功才返回
}
```

### 6.2 execute() 编排流程

```
execute(): Promise<AppBootstrap>
  ├ 1. db 读配置：getAppConfig('http_config') → 解析出 baseUrl/refreshUrl（若有）
  ├ 2. db 读 token：getSecretConfig('http_token') + getSecretConfig('http_refresh_token')
  ├ 3. 若 token 存在 → http.tokens.setToken(token) + setRefreshToken(refreshToken)
  ├ 4. db 读 sdk 配置：getAppConfig('sdk_config') → 解析出 SdkConfig
  ├ 5. 若 sdk 配置存在 → sdk.init(config) → session
  └ 6. 返回 AppBootstrap { sdkSession }
```

### 6.3 错误处理

- **每步错误直接抛**（与 scan-and-upload 一致）：db 读失败→抛；http.setToken 失败→抛；sdk.init 失败→抛。
- 配置缺失不等于错：db 没预置 token → http.setToken 跳过（继续 sdk）；没预置 sdk_config → sdk.init 跳过（返回无 session）。只有"读取抛错"才抛 UseCaseError。

### 6.4 关键决策

- 配置驱动：db 是配置源（http_config/sdk_config 存 app_config，token 存 secret_config）。验证"配置 → 服务初始化"单向数据流。
- 顺序同步：db 读 → http 鉴权 → sdk 初始化，严格顺序。
- 不做：配置不存在时的引导流程（首次启动向导）、自动重试。

## 7. 错误处理

### 7.1 UseCaseError 类型

```ts
// src/main/use-cases/errors.ts
type UseCaseErrorCategory = 'sdk' | 'db' | 'http' | 'orchestration'

class UseCaseError extends Error {
  readonly category: UseCaseErrorCategory
  readonly cause?: unknown   // 原始 SdkError/DbError/HttpError
}
```

### 7.2 错误来源映射

| category | 来源 | 何时 |
|---|---|---|
| sdk | SdkError | scan 的 init/open/startScan/dispose 失败；config 的 sdk.init 失败 |
| db | DbError | scan 落库失败；config 读配置失败 |
| http | HttpError | scan 上传失败；config setToken 失败 |
| orchestration | — | 编排逻辑自身错（事件超时、参数非法） |

### 7.3 包装机制

- `wrapServiceError(e, category): UseCaseError`：把捕获的 SdkError/DbError/HttpError 包成 UseCaseError，保留原错误为 `cause`。
- use-case 内每个服务调用 try/catch，分类包装后抛。
- **两个用例都"每步错误直接抛"**：不分容错，出错就抛 UseCaseError。scan 的 finally 清理是资源管理，与错误策略无关。

### 7.4 关键决策

- category 对齐服务：sdk/db/http + orchestration。UI 看 category 决定提示。
- cause 不跨 IPC：UseCaseError 经 IPC 序列化时只带 category + message（cause 是 Error 实例不可结构化克隆）。序列化成 `SerializedUseCaseError { category, message }`。
- 不重新发明业务码：用 category + message 够 POC。

## 8. 测试策略

### 8.1 桩服务

- `FakeSdkClient`：实现 ISdkClient；startScan 后异步投递预设事件；记录 init/open/dispose 调用；可配置抛错。
- `InMemoryDbClient`：实现 IDbClient；内存 Map 存 app_config/secret_config。
- `FakeHttpClient`：实现 IHttpClient；post 返回预设响应；tokens 是 InMemoryTokenStore；可配置抛错。

### 8.2 单元测试（vitest，桩驱动）

**ScanAndUploadUseCase**：
- 成功路径：init→open→startScan→收 2 事件→db 落库（断言 setAppConfig 被调）→http 上传（断言 post 被调 + body 含事件）→dispose→返回 ScanResult。
- sdk.init 失败 → 抛 UseCaseError(category=sdk) → 不调 db/http。
- db 落库失败 → 抛 UseCaseError(category=db) → 仍 dispose。
- http 上传失败 → 抛 UseCaseError(category=http) → 仍 dispose。
- 事件超时 → 抛 UseCaseError(category=orchestration)。
- 清理验证：失败路径都断言 dispose/disposeSession 被调。

**ConfigLoadAuthUseCase**：
- 成功路径：db 预置 http_config + token + sdk_config → http.setToken 被调 → sdk.init 被调 → 返回 AppBootstrap(sdkSession)。
- db 读配置失败 → 抛 UseCaseError(category=db) → 不调 http/sdk。
- http.setToken 失败 → 抛 UseCaseError(category=http) → 不调 sdk。
- sdk.init 失败 → 抛 UseCaseError(category=sdk)。
- 配置缺失：db 没预置 token → http.setToken 不被调（跳过）→ 继续 sdk.init。

**errors**：wrapServiceError 把各服务错误包成 UseCaseError，category 正确，cause 保留。

### 8.3 集成测试

端到端：ConfigLoadAuthUseCase 成功 → ScanAndUploadUseCase 成功（串联两个用例）。

### 8.4 测试隔离

- 每用例新建桩（状态独立）；无真实资源。
- 事件等待用极小超时（500ms）避免慢测试。

### 8.5 与现有测试配置的关系

- use-case 测试放 `tests/use-cases/**`，默认纳入 `npm test`（纯桩，不需构建产物）。
- 三个 facade 的 `implements` 标注由 typecheck 验证接口匹配。

### 8.6 不在 5/6 测

- 真实服务集成（推迟 6/6 Electron 冲烟）。
- UI 进度回调、用例重试策略。

## 9. 交付清单（本子计划产出）

- `src/main/use-cases/` — services/scan-and-upload/config-load-auth/errors/types
- `src/main/sdk-service/sdk-client.ts`（修改）— implements ISdkClient
- `src/main/db-service/db-client.ts`（修改）— implements IDbClient
- `src/main/http-client/http-client.ts`（修改）— implements IHttpClient
- `src/main/ipc/register.ts`（修改）— 接入 use-case
- `src/renderer/src/views/UseCaseView.vue` + router `/use-case` — 验证页
- `tests/use-cases/` — 单测 + 集成测试

## 10. 验收标准

- `npm run typecheck`、`npm test`（含 use-case 单测/集成）、`npm run build` 全绿。
- 集成测试覆盖：两个用例的成功路径 + 各服务失败路径 + 清理验证 + 配置缺失跳过。
- 三个 facade `implements` 接口（typecheck 验证）。
- UseCaseError 经 IPC 序列化透传到渲染（category + message）。
- use-case 只依赖接口（不导入具体类），测试用桩验证可替换性。
