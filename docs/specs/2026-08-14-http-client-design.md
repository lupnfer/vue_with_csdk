# 网络层（http-client）设计

- 日期：2026-08-14
- 状态：待审阅
- 需求来源：`docs/specs/2026-08-11-code-reader-client-design.md` §6、§11
- 上游产物：子计划 1/6（脚手架）、2/6（sdk-service）、3/6（db-service），均已合并到 main
- 范围：子计划 4/6

## 1. 背景与目标

设计文档 §6 规定客户端用 Electron `net` 模块封装 HTTPS 请求，带拦截器、超时、指数退避重试、token 鉴权与 401 刷新；§11 #5 把企业内网代理/证书差异列为风险。

本子计划目标：**建立 http-client 完整骨架**——HttpClient（Electron net 封装 get/post + 拦截器 + 超时 + 指数退避重试）+ HttpError 分类 + token 鉴权（从 secret_config 取）+ 401 刷新重放，经 IPC 暴露到渲染进程可验证。

**约束确认：**
- 引擎既定：Electron `net` 模块（Chromium 网络栈，自动走系统代理、统一 TLS）。
- 交付边界：骨架 + get/post + 401 刷新。上传/下载（stream）、私有 CA 导入、完整 body 脱敏日志、POST 幂等键留到后续子计划。
- 测试策略：可插拔 `HttpTransport` + `FakeTransport` 测试桩，vitest 跑全部编排逻辑（重试/鉴权/401/并发刷新/脱敏）；`net` 真实集成推迟 6/6（Electron 手动冲烟）。
- native ABI/Electron 运行时：4/6 不跑 Electron 冲烟（同 3/6，net 要 Electron 运行时）。
- token + refreshToken 存 secret_config（复用 db-service 字段加密）；baseUrl/refreshUrl/timeout 存 app_config。
- **安全底线：token/refreshToken/Authorization 头绝不进日志**（4/6 安全验收项，非后续待办）。

## 2. 方案选择

采用 **拦截器链 + 中心化重试/刷新编排**（方案 A）。

| 方案 | 说明 | 结论 |
|---|---|---|
| A. 拦截器链 + 中心化编排 | `request()` 单入口；请求拦截器链（auth 注入 token）+ 响应拦截器链（401→刷新→重放）；重试循环集中；HttpTransport 抽象发请求 | 采用 |
| B. 分散重试到每方法 | get/post 各自实现重试+401，重复代码多、难测 | 否决 |
| C. 中间件洋葱模型 | 类 Koa 洋葱式中间件，最灵活但 POC 过度 | 否决 |

理由：方案 A 是 §6"带拦截器、超时、指数退避重试"的标准实现，单入口易测（FakeTransport 注入响应序列即可验证重试次数/退避/401 刷新重放），transport 抽象把 Electron net 隔离到一处。重试只对幂等方法生效（GET/PUT 重试；POST/DELETE 默认不重试，POC 不做幂等键）——与 §6 一致。

## 3. 模块结构

```
src/main/http-client/
├── transport.ts          # HttpTransport 接口 + HttpRequest/HttpResponse 类型；NetTransport（Electron net，运行时）
├── http-error.ts         # HttpError + translateTransportError + serialize/deserialize + redactHeaders
├── token-store.ts        # TokenStore 接口；DbTokenStore（生产，背后 db-service secret_config）；InMemoryTokenStore（测试桩）
├── interceptors.ts       # 请求拦截器（auth 注入）+ 响应拦截器（401 触发刷新）
├── http-client.ts        # HttpClient：request() 单入口 + 重试循环 + 拦截器链 + 401 刷新重放 + 并发刷新去重
├── config.ts             # HttpConfig（baseUrl/refreshUrl/timeout/maxRetries）从 db-service app_config 读写
└── types.ts              # 对外 TS 接口（无 net 细节）

src/shared/ipc/
├── channels.ts（扩展）   # HTTP_CHANNELS + zod schema
└── api.ts（扩展）        # RendererApi.http: { get, post, ... }

src/main/ipc/register.ts（扩展） # http handler → HttpClient
src/preload/index.ts（扩展）     # window.api.http.*
src/renderer/src/views/HttpView.vue + router /http  # 验证页
tests/http/*.test.ts              # 单测 + 集成（FakeTransport 驱动）
```

### 关键决策

- **HttpClient 在主进程**（facade + 编排中心），主进程单例（同 SdkClient/DbClient）。构造时注入 `HttpTransport` + `TokenStore` + `HttpConfig`。**绝不在渲染进程**——token/net/加密库都必须留在主进程（§3.1、§6、§10）。
- **HttpTransport 抽象**：`NetTransport`（Electron `net.request`，运行时）+ `FakeTransport`（测试桩，预设响应序列/延迟/超时/错误）。HttpClient 永远只调 transport，不直接碰 net。
- **TokenStore 背后是 db-service**：`getToken()`/`setToken()` 调 `DbClient.getSecretConfig('http_token')` / `setSecretConfig`。验证 http↔db 集成。测试用 InMemoryTokenStore 桩绕开 db。
- **HttpConfig 背后也是 db-service**：baseUrl/refreshUrl/timeout/maxRetries 存 app_config（key `http_config`，JSON）。
- **不进 worker**：net 请求异步非阻塞，主进程直跑（同 db）。

### 渲染进程分工（§3.1、§6、§10 硬约束）

```
渲染进程（纯净）           preload（白名单）         主进程
  HttpView 按钮              window.api.http.get  →  HttpClient.request()
  "我要查用户列表"            （只传业务意图）         ├ 注入 token（TokenStore）
                                                     ├ transport.send（Electron net）
                                                     ├ 401? 刷新 token（secret_config）+ 重放
                                                     └ 返回业务数据（不含 token）
       ←————————————— 业务数据（无凭证）—————————————
```

渲染进程永远拿不到 token、碰不到 net、不接触加密库。只发意图、收业务数据。

## 4. HttpTransport 与请求/响应模型

### 4.1 接口

```ts
interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  url: string            // 完整 URL（HttpClient 拼 baseUrl + path）
  headers: Record<string, string>
  body?: string          // JSON 字符串
  timeoutMs: number
}

interface HttpResponse {
  status: number
  headers: Record<string, string>
  body: string
}

interface HttpTransport {
  send(req: HttpRequest): Promise<HttpResponse>
}
```

### 4.2 NetTransport（默认，Electron 运行时）

- 用 `net.request(req.url, { method })`，写 headers/body，监听 `response` 收 status+headers+body。
- 超时：`setTimeout(() => req.destroy(), timeoutMs)`，超时 reject `HttpError(kind: 'timeout')`。
- 网络层错误（DNS/连接/TLS）→ reject `HttpError(kind: 'network')`。
- 只在 Electron 运行时可用；非 Electron 抛错。4/6 测试用 FakeTransport 绕开。

### 4.3 FakeTransport（测试桩）

- 构造时传入响应队列或响应函数：预设一串响应（如 `[401, 200]` 测刷新重放）、延迟（测超时）、抛错（测网络错误）。
- 记录所有收到的请求（method/url/headers/body），供断言"token 注入了""重试了 N 次""刷新请求发了"。
- 不碰 net、不碰 Electron。

### 4.4 关键决策

- **HttpClient 拼 URL**：上层 `http.get('/users')`，HttpClient 拼 `baseUrl + '/users'`。transport 只收完整 URL——baseUrl 逻辑隔离在 HttpClient，transport 纯粹"发请求收响应"。
- **body 是 string**：HttpClient 负责 JSON.stringify，transport 不关心序列化。上传/下载（二进制 stream）留后续。
- **transport.send 是唯一出口**：上层不直接碰 transport，经 `request()` 编排。将来换 fetch 后端或 mock server 只换 transport 实现。

## 5. 重试与 401 刷新编排（HttpClient 核心）

### 5.1 request() 编排流程

```
request(method, path, { body, headers })
  ├ 1. 拼 URL（baseUrl + path）
  ├ 2. 请求拦截器链：auth 注入 token + 合并用户 headers
  ├ 3. 重试循环（最多 maxRetries 次，默认 3）：
  │     ├ transport.send(req)
  │     ├ 成功（2xx）→ 响应拦截器链 → 返回 body
  │     ├ 401 且未在刷新中 → 触发刷新 → 用新 token 重放（不计入重试次数）
  │     ├ 401 且刷新失败/已刷新过仍 401 → 抛 HttpError(kind: 'auth')，通知 UI 重登
  │     ├ 5xx 或网络错误 且 幂等（GET/PUT）→ 指数退避后重试
  │     ├ 5xx 或网络错误 且 非幂等（POST/DELETE）→ 直接抛，不重试
  │     ├ 4xx（非 401）→ 抛 HttpError(kind: 'business')，不重试
  │     └ 超时 → 抛 HttpError(kind: 'timeout')，幂等则重试
  └ 4. 重试耗尽仍失败 → 抛最后一次的 HttpError
```

### 5.2 401 刷新子流程

```
refreshToken():
  ├ 读 refreshToken（TokenStore.getRefreshToken()）
  ├ 若无 refreshToken → 抛 auth 错误（通知 UI 重登）
  ├ transport.send({ method: 'POST', url: refreshUrl, body: { refreshToken } })
  │   （刷新请求本身不重试、不带 auth 拦截器，避免递归）
  ├ 成功 → TokenStore.setToken(newToken) + setRefreshToken(newRefreshToken)
  ├ 失败（401/网络/超时）→ 抛 auth 错误（通知 UI 重登）
  └ 返回 newToken
```

刷新后，原请求**重新走拦截器链**（注入新 token）再 `transport.send`。仍 401 → 抛 auth 错误（防无限刷新循环）。

### 5.3 关键决策

- **幂等性决定重试**：GET/PUT 可重试（5xx/网络/超时）；POST/DELETE 默认不重试（除非带幂等键，POC 不做）。与 §6 一致。
- **401 重放不计入重试次数**：刷新是"凭证修复"不是重试；但只允许一次刷新（防循环）。
- **刷新请求本身不重试、不带 auth**：避免 401→刷新→401→刷新 递归。
- **指数退避 + jitter**：`delay = min(baseDelay × 2^attempt, maxDelay) × (0.5 + random×0.5)`，base 200ms，max 5s。
- **并发刷新去重（single-flight）**：多个请求同时 401 只发一次刷新，其他等同一 `refreshPromise`。避免刷新接口被并发打爆。

## 6. 错误处理

### 6.1 HttpError 类型

```ts
type HttpErrorKind = 'network' | 'auth' | 'timeout' | 'server' | 'business'

class HttpError extends Error {
  readonly kind: HttpErrorKind
  readonly status?: number
  readonly retryable: boolean
}
```

| kind | 触发 | status | retryable |
|---|---|---|---|
| network | DNS/连接/TLS 失败 | 无 | true（幂等则重试） |
| timeout | 超时 | 无 | true（幂等则重试） |
| auth | 401 刷新失败/无 refreshToken | 401 | false |
| server | 5xx | 5xx | true（幂等则重试） |
| business | 4xx 非 401 | 4xx | false |

- `translateTransportError`：把 transport 抛的原始错误映射到 HttpError。
- 序列化跨 IPC：`SerializedHttpError { kind, status?, message, retryable }`，渲染层只看 kind 决定 UI。

### 6.2 脱敏（安全底线）

- `redactHeaders(headers)`：把 `authorization`/`cookie` 等敏感头的值替换为 `***`。
- HttpClient 凡是打日志处（重试、错误、刷新），用 redactHeaders 处理后再输出。
- **验收项：日志字符串不含原 token/refreshToken/Authorization 值，只含 `***`。**
- 不在 4/6 做：完整 body 字段级脱敏、electron-log 集成、日志级别控制——留后续。

## 7. TokenStore 与 HttpConfig

### 7.1 TokenStore（背后 db-service secret_config）

```ts
interface TokenStore {
  getToken(): Promise<string | null>
  setToken(token: string): Promise<void>
  getRefreshToken(): Promise<string | null>
  setRefreshToken(token: string): Promise<void>
  clear(): Promise<void>
}
```

- **DbTokenStore（生产）**：`getToken` → `dbClient.getSecretConfig('http_token')`；`setToken` → `setSecretConfig('http_token', token)`。refreshToken 同理（key `http_refresh_token`）。复用 db-service 字段加密。
- **InMemoryTokenStore（测试桩）**：内存 Map，vitest 用它跑刷新全流程，不耦合真实库。

### 7.2 HttpConfig（背后 db-service app_config）

```ts
interface HttpConfig {
  baseUrl: string
  refreshUrl: string
  timeoutMs: number       // 默认 10000
  maxRetries: number      // 默认 3
}
```

- 从 app_config 读（key `http_config`，存 JSON）；未设置则用默认值。
- `loadConfig()` 启动时读一次缓存；`setConfig()` 运行时改并持久化（设置页用）。

## 8. 测试策略

### 8.1 单元测试（vitest，FakeTransport + InMemoryTokenStore）

全程用 `FakeTransport` + `InMemoryTokenStore` + 内存 HttpConfig。不碰 net/Electron/真实库。

- **http-error**：translateTransportError 各类映射（network/timeout/5xx/4xx）正确。
- **基础请求**：get/post 拼 URL、注入 token（断言 FakeTransport 收到的 Authorization 头）、返回 body。
- **重试**：GET 遇 500 → 指数退避重试 N 次后成功（断言重试次数+退避间隔）；重试耗尽抛 server 错误。POST 遇 500 → 不重试直接抛。
- **超时**：FakeTransport 延迟超 timeoutMs → timeout 错误；幂等方法重试。
- **401 刷新重放**：FakeTransport 队列 `[401, 刷新成功 200, 原请求 200]` → 第一次 401 触发刷新 → 用新 token 重放 → 成功。断言刷新请求发了、原请求重放带了新 token。
- **401 刷新失败**：refreshToken 缺失 / 刷新接口 401 → 抛 auth 错误。
- **并发刷新去重**：两个请求同时 401 → 只发一次刷新（断言 FakeTransport 的刷新请求只 1 次），两个都重放成功。
- **脱敏**：HttpClient 打错误日志时，Authorization 头值不出现（断言日志字符串不含原 token，只含 `***`）。
- **TokenStore/Config**：InMemoryTokenStore 读写；HttpConfig 默认值 + 覆盖。

### 8.2 集成测试（vitest，同一套环境）

端到端：配置 baseUrl → setToken → GET（FakeTransport 200）→ 验证响应；再 GET（FakeTransport 401→刷新 200→重放 200）→ 验证新 token 写回 + 响应正确。

### 8.3 测试隔离

- FakeTransport/InMemoryTokenStore 每用例新建，无状态污染。
- 不发真实网络请求（FakeTransport 拦截一切）。
- 退避延迟用极小 baseDelay（1ms）避免慢测试。

### 8.4 NetTransport 真实集成

- 4/6 不测：net 要 Electron 运行时，4/6 不具备。代码写出来，运行时验证推迟 6/6。
- FakeTransport 覆盖全部编排逻辑，net 是薄壳，风险低。

### 8.5 不在 4/6 测

上传/下载、私有 CA、完整 body 脱敏日志、POST 幂等键——留后续。

### 8.6 与现有测试配置的关系

- http 测试放 `tests/http/**`，默认纳入 `npm test`（不需构建产物，纯 FakeTransport）。

## 9. 交付清单（本子计划产出）

- `src/main/http-client/` — transport/http-error/token-store/interceptors/http-client/config/types
- `src/main/ipc/register.ts`（扩展）— http handler
- `src/shared/ipc/{channels,api}.ts`（扩展）— http 契约
- `src/preload/index.ts`（扩展）— `window.api.http`
- `src/renderer/src/views/HttpView.vue` + router `/http` — 验证页
- `tests/http/` — 单测 + 集成测试

## 10. 验收标准

- `npm run typecheck`、`npm test`（含 http 单测/集成）、`npm run build` 全绿。
- 集成测试覆盖：基础请求、重试（幂等/非幂等）、超时、401 刷新重放、401 刷新失败、并发刷新去重、脱敏。
- HttpClient 经 IPC 暴露到渲染（`window.api.http.*`），渲染只发业务意图、收业务数据（无 token 泄露）。
- **安全验收：日志中不含原 token/refreshToken/Authorization 值（只含 `***`）。**
- HttpTransport/TokenStore/Config 可插拔：FakeTransport/InMemoryTokenStore 跑测试，NetTransport/DbTokenStore 代码就位（运行时验证推迟 6/6）。
- HttpError 五类（network/auth/timeout/server/business）类型化并经 IPC 透传到渲染。
