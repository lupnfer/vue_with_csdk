# http-client 实施计划（子计划 4/6）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 http-client 完整骨架——HttpClient（Electron net 封装 get/post + 拦截器 + 超时 + 指数退避重试）+ HttpError 分类 + token 鉴权（从 secret_config）+ 401 刷新重放 + 并发刷新去重 + 凭证脱敏，经 IPC 暴露到渲染进程可验证。

**Architecture:** 拦截器链 + 中心化重试/刷新编排（方案 A）。`request()` 单入口；请求拦截器注入 token，响应处理 401→刷新→重放。HttpTransport 抽象"发请求"（NetTransport 用 Electron net，FakeTransport 测试桩），HttpClient 永远只调 transport。TokenStore/HttpConfig 背后是 db-service（secret_config/app_config）。**HttpClient 在主进程**——token/net/加密库绝不进渲染进程。

**Tech Stack:** Electron `net`（运行时）、Node `crypto`（无，仅用 random 做 jitter）、zod（IPC 契约）、Vitest（单测+集成，FakeTransport 驱动）。

## Global Constraints

- Electron `net` API（`node_modules/electron/electron.d.ts`）：`net.request(url | options): ClientRequest`；`req.on('response', (res: IncomingMessage) => {})`；`req.on('error', (err) => {})`；`req.setHeader(name, value)`；`req.write(chunk)`；`req.end()`；`req.destroy()`；`res.on('data', (chunk: Buffer) => {})`；`res.on('end', ())`；`res.statusCode`；`res.headers`。
- **native ABI/Electron 运行时：4/6 不跑 Electron 冲烟**（net 要 Electron 运行时，同 3/6）。vitest 用 FakeTransport 跑全部编排逻辑；NetTransport 代码写出来，运行时验证推迟 6/6。
- **`require('electron')` 动态取 net**：vitest 非 Electron 下 `require('electron')` 返回字符串路径（或经 `ELECTRON_OVERRIDE_DIST_PATH` env 返回 dummy），`.net` 为 undefined。NetTransport 构造时检查 net 可用性，不可用则抛错（同 SafeStorageKeyProvider 降级模式）。FakeTransport 绕开。
- TypeScript `strict: true`；IPC 契约只定义在 `src/shared/`。
- http 测试放 `tests/http/**`，默认纳入 `npm test`（不需构建产物，纯 FakeTransport）。
- **安全底线：token/refreshToken/Authorization 头绝不进日志**——redactHeaders 把敏感头值替换为 `***`，是 4/6 验收项。
- 重试只对幂等方法（GET/PUT）生效；POST/DELETE 默认不重试。401 重放不计入重试次数，只允许一次刷新（防循环）。并发刷新用 single-flight（`refreshPromise`）。
- 提交信息用 Conventional Commits。

---

## 文件结构（本子计划创建/修改）

- `src/main/http-client/http-error.ts` — HttpError + translateTransportError + serialize/deserialize + redactHeaders
- `src/main/http-client/transport.ts` — HttpTransport 接口 + HttpRequest/HttpResponse + NetTransport + FakeTransport
- `src/main/http-client/token-store.ts` — TokenStore 接口 + DbTokenStore + InMemoryTokenStore
- `src/main/http-client/config.ts` — HttpConfig + loadConfig/setConfig（背后 app_config）
- `src/main/http-client/interceptors.ts` — auth 请求拦截器 + 401 响应处理
- `src/main/http-client/http-client.ts` — HttpClient（request 编排 + 重试 + 401 刷新重放 + single-flight + 脱敏日志）
- `src/main/http-client/types.ts` — 对外 TS 接口
- `src/shared/ipc/channels.ts`（修改）— HTTP_CHANNELS + zod schema
- `src/shared/ipc/api.ts`（修改）— RendererApi.http
- `src/main/ipc/register.ts`（修改）— http handler
- `src/preload/index.ts`（修改）— window.api.http
- `src/renderer/src/views/HttpView.vue` + `router.ts`（修改）— 验证页
- `src/renderer/src/views/HomeView.vue`（修改）— 入口链接
- `tests/http/*.test.ts` — 单测 + 集成

---

### Task 1: http-error.ts（纯 TS，TDD）

**Files:**
- Create: `src/main/http-client/http-error.ts`
- Create: `tests/http/http-error.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/http/http-error.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { HttpError, translateTransportError, redactHeaders, serializeHttpError, deserializeHttpError } from '../../src/main/http-client/http-error'

describe('HttpError', () => {
  it('5xx 翻译为 server 错误且可重试', () => {
    const err = translateTransportError({ kind: 'http', status: 500, message: 'internal error' })
    expect(err).toBeInstanceOf(HttpError)
    expect(err.kind).toBe('server')
    expect(err.status).toBe(500)
    expect(err.retryable).toBe(true)
  })

  it('4xx 非 401 翻译为 business 错误不可重试', () => {
    const err = translateTransportError({ kind: 'http', status: 422, message: 'validation' })
    expect(err.kind).toBe('business')
    expect(err.retryable).toBe(false)
  })

  it('网络错误翻译为 network 可重试', () => {
    const err = translateTransportError({ kind: 'network', message: 'ECONNREFUSED' })
    expect(err.kind).toBe('network')
    expect(err.status).toBeUndefined()
    expect(err.retryable).toBe(true)
  })

  it('超时翻译为 timeout 可重试', () => {
    const err = translateTransportError({ kind: 'timeout', message: 'timed out' })
    expect(err.kind).toBe('timeout')
    expect(err.retryable).toBe(true)
  })
})

describe('redactHeaders', () => {
  it('authorization/cookie 值替换为 ***', () => {
    const redacted = redactHeaders({ Authorization: 'Bearer secret', Cookie: 'sid=x', Accept: 'json' })
    expect(redacted.Authorization).toBe('***')
    expect(redacted.Cookie).toBe('***')
    expect(redacted.Accept).toBe('json')
  })

  it('大小写不敏感', () => {
    const redacted = redactHeaders({ authorization: 'Bearer x', AUTHORIZATION: 'Bearer y' })
    expect(redacted.authorization).toBe('***')
    expect(redacted.AUTHORIZATION).toBe('***')
  })
})

describe('serialize/deserialize', () => {
  it('往返一致', () => {
    const err = new HttpError('server', 500, 'boom', true)
    const restored = deserializeHttpError(serializeHttpError(err))
    expect(restored).toBeInstanceOf(HttpError)
    expect(restored.kind).toBe('server')
    expect(restored.status).toBe(500)
    expect(restored.retryable).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/http/http-error.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 http-error.ts**

`src/main/http-client/http-error.ts`：

```ts
export type HttpErrorKind = 'network' | 'auth' | 'timeout' | 'server' | 'business'

export class HttpError extends Error {
  readonly kind: HttpErrorKind
  readonly status?: number
  readonly retryable: boolean

  constructor(kind: HttpErrorKind, status: number | undefined, message: string, retryable: boolean) {
    super(message)
    this.name = 'HttpError'
    this.kind = kind
    this.status = status
    this.retryable = retryable
  }
}

/** transport 抛出的原始错误形态 */
export interface RawTransportError {
  kind: 'http' | 'network' | 'timeout'
  status?: number
  message: string
}

export function translateTransportError(raw: RawTransportError): HttpError {
  if (raw.kind === 'network') {
    return new HttpError('network', undefined, raw.message, true)
  }
  if (raw.kind === 'timeout') {
    return new HttpError('timeout', undefined, raw.message, true)
  }
  // kind === 'http'：按状态码分
  const status = raw.status ?? 0
  if (status === 401) {
    return new HttpError('auth', status, raw.message, false)
  }
  if (status >= 500) {
    return new HttpError('server', status, raw.message, true)
  }
  if (status >= 400) {
    return new HttpError('business', status, raw.message, false)
  }
  return new HttpError('server', status, raw.message, true)
}

const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie'])

/** 把敏感头的值替换为 ***（大小写不敏感）。日志输出前必过此函数。 */
export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SENSITIVE_HEADERS.has(k.toLowerCase()) ? '***' : v
  }
  return out
}

export interface SerializedHttpError {
  kind: HttpErrorKind
  status?: number
  message: string
  retryable: boolean
}

export function serializeHttpError(err: HttpError): SerializedHttpError {
  return { kind: err.kind, status: err.status, message: err.message, retryable: err.retryable }
}

export function deserializeHttpError(data: SerializedHttpError): HttpError {
  return new HttpError(data.kind, data.status, data.message, data.retryable)
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run tests/http/http-error.test.ts
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main/http-client/http-error.ts tests/http/http-error.test.ts
git commit -m "feat(http): HttpError 分类与 redactHeaders 脱敏"
```

末尾空行加 `Co-Authored-By: Claude <noreply@anthropic.com>`

---

### Task 2: transport.ts（HttpTransport 接口 + NetTransport + FakeTransport）

**Files:**
- Create: `src/main/http-client/transport.ts`
- Create: `tests/http/transport.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/http/transport.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { FakeTransport, type HttpResponse } from '../../src/main/http-client/transport'

describe('FakeTransport', () => {
  it('按队列返回响应', async () => {
    const t = new FakeTransport([
      { status: 200, headers: {}, body: 'a' },
      { status: 200, headers: {}, body: 'b' }
    ])
    const r1 = await t.send({ method: 'GET', url: 'http://x', headers: {}, timeoutMs: 1000 })
    const r2 = await t.send({ method: 'GET', url: 'http://x', headers: {}, timeoutMs: 1000 })
    expect(r1.body).toBe('a')
    expect(r2.body).toBe('b')
  })

  it('记录收到的请求供断言', async () => {
    const t = new FakeTransport([{ status: 200, headers: {}, body: '' }])
    await t.send({ method: 'POST', url: 'http://x/users', headers: { Authorization: 'Bearer t' }, body: '{"a":1}', timeoutMs: 1000 })
    expect(t.requests).toHaveLength(1)
    expect(t.requests[0].method).toBe('POST')
    expect(t.requests[0].headers.Authorization).toBe('Bearer t')
    expect(t.requests[0].body).toBe('{"a":1}')
  })

  it('可抛错误模拟网络故障', async () => {
    const t = new FakeTransport([], { throwError: new Error('ECONNREFUSED') })
    await expect(t.send({ method: 'GET', url: 'http://x', headers: {}, timeoutMs: 1000 })).rejects.toThrow('ECONNREFUSED')
  })

  it('队列耗尽抛错', async () => {
    const t = new FakeTransport([{ status: 200, headers: {}, body: 'a' }])
    await t.send({ method: 'GET', url: 'http://x', headers: {}, timeoutMs: 1000 })
    await expect(t.send({ method: 'GET', url: 'http://x', headers: {}, timeoutMs: 1000 })).rejects.toThrow(/exhausted/)
  })

  it('可注入响应函数（动态）', async () => {
    const t = new FakeTransport((req) => ({ status: 200, headers: {}, body: req.url }))
    const r = await t.send({ method: 'GET', url: 'http://x/dynamic', headers: {}, timeoutMs: 1000 })
    expect(r.body).toBe('http://x/dynamic')
  })
})
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/http/transport.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 transport.ts**

`src/main/http-client/transport.ts`：

```ts
import type { HttpError } from './http-error'

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  url: string
  headers: Record<string, string>
  body?: string
  timeoutMs: number
}

export interface HttpResponse {
  status: number
  headers: Record<string, string>
  body: string
}

export interface HttpTransport {
  send(req: HttpRequest): Promise<HttpResponse>
}

/**
 * 默认实现：Electron `net` 模块。仅在 Electron 运行时可用。
 * 非 Electron 环境（如 vitest）下 getNet() 返回 undefined，send 抛错。
 * 4/6 测试用 FakeTransport 绕开；真实集成验证推迟 6/6。
 */
export class NetTransport implements HttpTransport {
  constructor() {
    if (!this.getNet()) {
      throw new Error('NetTransport requires Electron runtime (net unavailable)')
    }
  }

  async send(req: HttpRequest): Promise<HttpResponse> {
    const net = this.getNet()!
    return new Promise<HttpResponse>((resolve, reject) => {
      const request = net.request(req.url, { method: req.method })
      for (const [k, v] of Object.entries(req.headers)) request.setHeader(k, v)
      if (req.body) request.write(req.body)

      const timer = setTimeout(() => {
        request.destroy()
        reject({ kind: 'timeout', message: `request timed out after ${req.timeoutMs}ms` } as const)
      }, req.timeoutMs)

      request.on('response', (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          clearTimeout(timer)
          const headers: Record<string, string> = {}
          for (const [k, v] of Object.entries(res.headers ?? {})) {
            headers[k] = Array.isArray(v) ? v.join(', ') : (v as string)
          }
          resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks).toString('utf8') })
        })
        res.on('aborted', () => {
          clearTimeout(timer)
          reject({ kind: 'network', message: 'response aborted' } as const)
        })
      })

      request.on('error', (err: Error) => {
        clearTimeout(timer)
        reject({ kind: 'network', message: err.message } as const)
      })

      request.end()
    })
  }

  private getNet(): { request: (url: string, opts?: { method?: string }) => {
    setHeader(n: string, v: string): void
    write(chunk: string): void
    end(): void
    destroy(): void
    on(event: string, listener: (...args: any[]) => void): unknown
  } } | undefined {
    try {
      const electron = require('electron')
      return electron?.net
    } catch {
      return undefined
    }
  }
}

type ResponseProvider = HttpResponse[] | ((req: HttpRequest) => HttpResponse)

/**
 * 测试桩：按队列或函数返回预设响应，记录收到的请求，可抛错误模拟故障。
 */
export class FakeTransport implements HttpTransport {
  readonly requests: HttpRequest[] = []
  private queue: HttpResponse[]
  private provider?: (req: HttpRequest) => HttpResponse
  private throwError?: Error

  constructor(responses: ResponseProvider, opts?: { throwError?: Error }) {
    if (Array.isArray(responses)) {
      this.queue = responses
    } else {
      this.provider = responses
      this.queue = []
    }
    this.throwError = opts?.throwError
  }

  async send(req: HttpRequest): Promise<HttpResponse> {
    if (this.throwError) throw this.throwError
    this.requests.push(req)
    if (this.provider) return this.provider(req)
    const next = this.queue.shift()
    if (!next) throw new Error('FakeTransport queue exhausted')
    return next
  }
}

// 便于测试断言：导出 RawTransportError 的形态由 reject 的对象体现（见 http-error.ts 的 RawTransportError）
export type { HttpError }
```

> NetTransport 的 `send` reject 的是 `{ kind, message }` 字面量对象（匹配 RawTransportError 形态），HttpClient 在 catch 里用 `translateTransportError` 转成 HttpError。这样 transport 不依赖 http-error.ts 的类（避免循环），只产出数据。

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run tests/http/transport.test.ts
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main/http-client/transport.ts tests/http/transport.test.ts
git commit -m "feat(http): HttpTransport 接口 + NetTransport + FakeTransport"
```

---

### Task 3: token-store.ts 与 config.ts（TDD）

**Files:**
- Create: `src/main/http-client/token-store.ts`, `src/main/http-client/config.ts`
- Create: `tests/http/token-store-config.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/http/token-store-config.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { InMemoryTokenStore } from '../../src/main/http-client/token-store'
import { defaultHttpConfig, mergeConfig } from '../../src/main/http-client/config'

describe('InMemoryTokenStore', () => {
  it('读写 token + refreshToken', async () => {
    const s = new InMemoryTokenStore()
    await s.setToken('t1')
    await s.setRefreshToken('r1')
    expect(await s.getToken()).toBe('t1')
    expect(await s.getRefreshToken()).toBe('r1')
  })

  it('初始为 null', async () => {
    const s = new InMemoryTokenStore()
    expect(await s.getToken()).toBeNull()
    expect(await s.getRefreshToken()).toBeNull()
  })

  it('clear 清空', async () => {
    const s = new InMemoryTokenStore()
    await s.setToken('t1')
    await s.setRefreshToken('r1')
    await s.clear()
    expect(await s.getToken()).toBeNull()
    expect(await s.getRefreshToken()).toBeNull()
  })
})

describe('HttpConfig', () => {
  it('默认值', () => {
    const c = defaultHttpConfig()
    expect(c.timeoutMs).toBe(10000)
    expect(c.maxRetries).toBe(3)
    expect(c.baseUrl).toBe('')
    expect(c.refreshUrl).toBe('')
  })

  it('mergeConfig 覆盖默认', () => {
    const c = mergeConfig({ baseUrl: 'http://api', timeoutMs: 5000 })
    expect(c.baseUrl).toBe('http://api')
    expect(c.timeoutMs).toBe(5000)
    expect(c.maxRetries).toBe(3) // 未覆盖的保留默认
  })

  it('mergeConfig 从 JSON 字符串解析', () => {
    const c = mergeConfig(JSON.stringify({ baseUrl: 'http://x', refreshUrl: 'http://x/r' }))
    expect(c.baseUrl).toBe('http://x')
    expect(c.refreshUrl).toBe('http://x/r')
  })
})
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/http/token-store-config.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 token-store.ts**

`src/main/http-client/token-store.ts`：

```ts
export interface TokenStore {
  getToken(): Promise<string | null>
  setToken(token: string): Promise<void>
  getRefreshToken(): Promise<string | null>
  setRefreshToken(token: string): Promise<void>
  clear(): Promise<void>
}

/** 测试桩：内存存储，不碰 db/Electron。 */
export class InMemoryTokenStore implements TokenStore {
  private token: string | null = null
  private refresh: string | null = null

  async getToken(): Promise<string | null> {
    return this.token
  }
  async setToken(token: string): Promise<void> {
    this.token = token
  }
  async getRefreshToken(): Promise<string | null> {
    return this.refresh
  }
  async setRefreshToken(token: string): Promise<void> {
    this.refresh = token
  }
  async clear(): Promise<void> {
    this.token = null
    this.refresh = null
  }
}

/**
 * 生产实现：token + refreshToken 存 db-service 的 secret_config（字段加密）。
 * 构造时注入 DbClient（避免本模块直接依赖 db-client，靠接口耦合）。
 */
export interface SecretStore {
  getSecret(key: string): Promise<string | null>
  setSecret(key: string, value: string): Promise<void>
}

export class DbTokenStore implements TokenStore {
  private static readonly TOKEN_KEY = 'http_token'
  private static readonly REFRESH_KEY = 'http_refresh_token'

  constructor(private readonly secrets: SecretStore) {}

  async getToken(): Promise<string | null> {
    return this.secrets.getSecret(DbTokenStore.TOKEN_KEY)
  }
  async setToken(token: string): Promise<void> {
    await this.secrets.setSecret(DbTokenStore.TOKEN_KEY, token)
  }
  async getRefreshToken(): Promise<string | null> {
    return this.secrets.getSecret(DbTokenStore.REFRESH_KEY)
  }
  async setRefreshToken(token: string): Promise<void> {
    await this.secrets.setSecret(DbTokenStore.REFRESH_KEY, token)
  }
  async clear(): Promise<void> {
    await this.secrets.setSecret(DbTokenStore.TOKEN_KEY, '')
    await this.secrets.setSecret(DbTokenStore.REFRESH_KEY, '')
  }
}
```

- [ ] **Step 4: 实现 config.ts**

`src/main/http-client/config.ts`：

```ts
export interface HttpConfig {
  baseUrl: string
  refreshUrl: string
  timeoutMs: number
  maxRetries: number
}

export function defaultHttpConfig(): HttpConfig {
  return { baseUrl: '', refreshUrl: '', timeoutMs: 10000, maxRetries: 3 }
}

/** 从部分配置或 JSON 字符串合并出完整 HttpConfig（缺失项用默认）。 */
export function mergeConfig(input: Partial<HttpConfig> | string): HttpConfig {
  const def = defaultHttpConfig()
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as Partial<HttpConfig>
      return { ...def, ...parsed }
    } catch {
      return def
    }
  }
  return { ...def, ...input }
}

/** 生产用：从 db-service 的 app_config 读写 HttpConfig。 */
export interface AppConfigStore {
  getAppConfig(key: string): Promise<string | null>
  setAppConfig(key: string, value: string): Promise<void>
}

export class DbHttpConfig {
  private static readonly CONFIG_KEY = 'http_config'
  private cached: HttpConfig | null = null

  constructor(private readonly store: AppConfigStore) {}

  async load(): Promise<HttpConfig> {
    if (this.cached) return this.cached
    const raw = await this.store.getAppConfig(DbHttpConfig.CONFIG_KEY)
    this.cached = mergeConfig(raw ?? defaultHttpConfig())
    return this.cached
  }

  async set(config: Partial<HttpConfig>): Promise<void> {
    const current = await this.load()
    this.cached = { ...current, ...config }
    await this.store.setAppConfig(DbHttpConfig.CONFIG_KEY, JSON.stringify(this.cached))
  }
}
```

- [ ] **Step 5: 运行确认通过**

```bash
npx vitest run tests/http/token-store-config.test.ts
```

预期：PASS。

- [ ] **Step 6: Commit**

```bash
git add src/main/http-client/token-store.ts src/main/http-client/config.ts tests/http/token-store-config.test.ts
git commit -m "feat(http): TokenStore（Db + InMemory）与 HttpConfig"
```

---

### Task 4: http-client.ts 核心（request 编排 + 重试，无 401 刷新）

**Files:**
- Create: `src/main/http-client/http-client.ts`, `src/main/http-client/types.ts`
- Create: `tests/http/http-client-retry.test.ts`

> 分两步：Task 4 先做 request 编排 + 重试（无 401 刷新），Task 5 再加 401 刷新重放 + single-flight。降低单 Task 复杂度。

- [ ] **Step 1: 实现 types.ts**

`src/main/http-client/types.ts`：

```ts
export interface RequestOptions {
  headers?: Record<string, string>
  body?: unknown        // 会被 JSON.stringify
  timeoutMs?: number
}

export interface TypedResponse<T = unknown> {
  status: number
  body: T
}
```

- [ ] **Step 2: 实现 http-client.ts（重试版，无 401 刷新）**

`src/main/http-client/http-client.ts`：

```ts
import type { HttpTransport, HttpRequest, HttpResponse } from './transport'
import type { TokenStore } from './token-store'
import type { HttpConfig } from './config'
import type { RequestOptions, TypedResponse } from './types'
import { HttpError, translateTransportError, redactHeaders } from './http-error'

const IDEMPOTENT = new Set(['GET', 'PUT'])

export class HttpClient {
  constructor(
    private readonly transport: HttpTransport,
    readonly tokens: TokenStore,
    private readonly config: HttpConfig
  ) {}

  async get<T = unknown>(path: string, opts?: RequestOptions): Promise<TypedResponse<T>> {
    return this.request<T>('GET', path, opts)
  }
  async post<T = unknown>(path: string, opts?: RequestOptions): Promise<TypedResponse<T>> {
    return this.request<T>('POST', path, opts)
  }
  async put<T = unknown>(path: string, opts?: RequestOptions): Promise<TypedResponse<T>> {
    return this.request<T>('PUT', path, opts)
  }
  async delete<T = unknown>(path: string, opts?: RequestOptions): Promise<TypedResponse<T>> {
    return this.request<T>('DELETE', path, opts)
  }

  async request<T = unknown>(method: HttpRequest['method'], path: string, opts?: RequestOptions): Promise<TypedResponse<T>> {
    const url = this.config.baseUrl + path
    const timeoutMs = opts?.timeoutMs ?? this.config.timeoutMs
    const body = opts?.body !== undefined ? JSON.stringify(opts.body) : undefined

    const maxAttempts = IDEMPOTENT.has(method) ? this.config.maxRetries + 1 : 1
    let lastError: HttpError | null = null

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await this.backoff(attempt)
      }
      try {
        const req = await this.buildRequest(method, url, opts?.headers, body, timeoutMs)
        const res = await this.transport.send(req)
        // transport 不对非 2xx 抛错（FakeTransport/NetTransport 都直接返回响应），
        // 这里把 >= 400 转成 {kind:'http', status, message} 抛出，交给 catch→toHttpError→translateTransportError
        if (res.status >= 400) {
          throw { kind: 'http', status: res.status, message: res.body || `HTTP ${res.status}` }
        }
        return { status: res.status, body: this.parseBody(res) as T }
      } catch (e) {
        lastError = this.toHttpError(e)
        this.logError(method, path, lastError, attempt)
        // 非幂等或不可重试：直接抛
        if (!IDEMPOTENT.has(method) || !lastError.retryable) {
          throw lastError
        }
        // 否则进入下一轮重试
      }
    }
    throw lastError ?? new HttpError('network', undefined, 'exhausted retries', false)
  }

  private async buildRequest(
    method: HttpRequest['method'],
    url: string,
    userHeaders: Record<string, string> | undefined,
    body: string | undefined,
    timeoutMs: number
  ): Promise<HttpRequest> {
    const headers: Record<string, string> = { ...(userHeaders ?? {}) }
    const token = await this.tokens.getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
    if (body) headers['Content-Type'] = 'application/json'
    return { method, url, headers, body, timeoutMs }
  }

  private parseBody(res: HttpResponse): unknown {
    if (!res.body) return null
    try {
      return JSON.parse(res.body)
    } catch {
      return res.body
    }
  }

  private toHttpError(e: unknown): HttpError {
    if (e instanceof HttpError) return e
    // transport reject 的是 { kind, status?, message } 字面量
    const raw = e as { kind?: string; status?: number; message?: string }
    if (raw.kind) {
      return translateTransportError({ kind: raw.kind as 'http' | 'network' | 'timeout', status: raw.status, message: raw.message ?? String(e) })
    }
    return new HttpError('network', undefined, e instanceof Error ? e.message : String(e), true)
  }

  private async backoff(attempt: number): Promise<void> {
    const base = 200
    const max = 5000
    const exp = Math.min(base * 2 ** (attempt - 1), max)
    const jitter = exp * (0.5 + Math.random() * 0.5)
    await new Promise((r) => setTimeout(r, jitter))
  }

  private logError(method: string, path: string, err: HttpError, attempt: number): void {
    // 日志只含脱敏信息，绝不出现 token（Authorization 头不在此日志里）
    console.debug(`[http] ${method} ${path} attempt=${attempt} failed: ${err.kind} ${err.status ?? ''} ${err.message}`)
  }
}

export { HttpError, redactHeaders }
```

> 注意：logError 不打印 headers（避免任何凭证泄漏）；redactHeaders 在 Task 5（401 刷新日志）和未来完整日志时用。此处先 export 备用。

- [ ] **Step 3: 写重试测试**

`tests/http/http-client-retry.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { HttpClient } from '../../src/main/http-client/http-client'
import { FakeTransport } from '../../src/main/http-client/transport'
import { InMemoryTokenStore } from '../../src/main/http-client/token-store'
import { defaultHttpConfig } from '../../src/main/http-client/config'
import { HttpError } from '../../src/main/http-client/http-error'

function client(responses: Parameters<typeof FakeTransport>[0], config = defaultHttpConfig()): { http: HttpClient; transport: FakeTransport } {
  const transport = new FakeTransport(responses)
  const http = new HttpClient(transport, new InMemoryTokenStore(), { ...config, timeoutMs: 1000 })
  return { http, transport }
}

describe('HttpClient 基础请求', () => {
  it('get 返回解析后的 JSON body', async () => {
    const { http } = client([{ status: 200, headers: {}, body: '{"x":1}' }])
    const res = await http.get<{ x: number }>('/users')
    expect(res.status).toBe(200)
    expect(res.body.x).toBe(1)
  })

  it('注入 Authorization 头', async () => {
    const { http, transport } = client([{ status: 200, headers: {}, body: '{}' }])
    await http.tokens.setToken('my-token')
    await http.get('/x')
    expect(transport.requests[0].headers.Authorization).toBe('Bearer my-token')
  })

  it('拼 baseUrl + path', async () => {
    const { http, transport } = client([{ status: 200, headers: {}, body: '{}' }], { ...defaultHttpConfig(), baseUrl: 'http://api' })
    await http.get('/users')
    expect(transport.requests[0].url).toBe('http://api/users')
  })
})

describe('HttpClient 重试', () => {
  it('GET 遇 500 重试到成功', async () => {
    const { http, transport } = client([
      { status: 500, headers: {}, body: 'err' },
      { status: 200, headers: {}, body: '{"ok":true}' }
    ])
    const res = await http.get<{ ok: boolean }>('/x')
    expect(res.body.ok).toBe(true)
    expect(transport.requests).toHaveLength(2)
  })

  it('GET 重试耗尽抛 server 错误', async () => {
    const { http } = client([
      { status: 500, headers: {}, body: 'e' },
      { status: 500, headers: {}, body: 'e' },
      { status: 500, headers: {}, body: 'e' },
      { status: 500, headers: {}, body: 'e' }
    ])
    await expect(http.get('/x')).rejects.toMatchObject({ kind: 'server', status: 500 })
  })

  it('POST 遇 500 不重试直接抛', async () => {
    const { http, transport } = client([{ status: 500, headers: {}, body: 'e' }])
    await expect(http.post('/x', { body: { a: 1 } })).rejects.toMatchObject({ kind: 'server' })
    expect(transport.requests).toHaveLength(1)
  })

  it('4xx 非 401 不重试抛 business', async () => {
    const { http, transport } = client([{ status: 422, headers: {}, body: 'bad' }])
    await expect(http.get('/x')).rejects.toMatchObject({ kind: 'business', status: 422 })
    expect(transport.requests).toHaveLength(1)
  })
})
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run tests/http/http-client-retry.test.ts
```

预期：PASS。注意：重试有 backoff（200ms+），测试会稍慢（约 0.5s），可接受。若想加速，可在测试 config 里把 maxRetries 调小——但保持默认值更能验证真实行为。

- [ ] **Step 5: Commit**

```bash
git add src/main/http-client/http-client.ts src/main/http-client/types.ts tests/http/http-client-retry.test.ts
git commit -m "feat(http): HttpClient request 编排与指数退避重试"
```

---

### Task 5: 401 刷新重放 + 并发去重（single-flight）

**Files:**
- Modify: `src/main/http-client/http-client.ts`（加 refreshToken + single-flight + 重放）
- Create: `tests/http/http-client-refresh.test.ts`

- [ ] **Step 1: 修改 http-client.ts 加 401 刷新**

在 `request` 方法的 catch 块里，识别 401（kind=auth 但来自 transport 的 401 状态），触发刷新→重放。关键改动：

把 `request` 方法的 try/catch 内的 catch 分支改为：

```ts
      } catch (e) {
        const err = this.toHttpError(e)
        // 401：尝试刷新 token 后重放一次（不计入重试次数）
        if (err.kind === 'auth' && err.status === 401 && !refreshed) {
          try {
            const newToken = await this.refreshTokens()
            refreshed = true
            // 重放：用新 token 重新发本次请求（不进入退避，attempt 不递增）
            const req = await this.buildRequest(method, url, opts?.headers, body, timeoutMs)
            const res = await this.transport.send(req)
            return { status: res.status, body: this.parseBody(res) as T }
          } catch (refreshErr) {
            this.logError(method, path, this.toHttpError(refreshErr), attempt)
            throw this.toHttpError(refreshErr)
          }
        }
        lastError = err
        this.logError(method, path, err, attempt)
        if (!IDEMPOTENT.has(method) || !err.retryable) {
          throw err
        }
      }
```

并在 `request` 方法顶部加 `let refreshed = false`。

在类里加 single-flight 刷新方法：

```ts
  private refreshPromise: Promise<string> | null = null

  /** 刷新 token（single-flight：并发 401 只发一次刷新）。 */
  private async refreshTokens(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = (async () => {
      try {
        const refreshToken = await this.tokens.getRefreshToken()
        if (!refreshToken) throw new HttpError('auth', 401, 'no refresh token', false)
        // 刷新请求本身不带 auth 拦截器、不重试，避免递归
        const res = await this.transport.send({
          method: 'POST',
          url: this.config.refreshUrl,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
          timeoutMs: this.config.timeoutMs
        })
        if (res.status !== 200) throw new HttpError('auth', res.status, `refresh failed: ${res.status}`, false)
        const data = JSON.parse(res.body) as { token: string; refreshToken: string }
        await this.tokens.setToken(data.token)
        await this.tokens.setRefreshToken(data.refreshToken)
        return data.token
      } finally {
        this.refreshPromise = null
      }
    })()
    return this.refreshPromise
  }
```

> 单文件完整改动较大，实施时把整个 `request` 方法和新增 `refreshTokens` 一并写入。注意 `refreshed` 标志保证只刷新一次（防 401→刷新→仍 401→再刷新 的循环）。

- [ ] **Step 2: 写刷新测试**

`tests/http/http-client-refresh.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { HttpClient } from '../../src/main/http-client/http-client'
import { FakeTransport } from '../../src/main/http-client/transport'
import { InMemoryTokenStore } from '../../src/main/http-client/token-store'
import { defaultHttpConfig } from '../../src/main/http-client/config'

const cfg = { ...defaultHttpConfig(), baseUrl: 'http://api', refreshUrl: 'http://api/refresh', timeoutMs: 1000, maxRetries: 0 }

describe('HttpClient 401 刷新重放', () => {
  it('401 触发刷新并重放成功', async () => {
    const transport = new FakeTransport([
      { status: 401, headers: {}, body: '' },                                    // 首次请求 401
      { status: 200, headers: {}, body: '{"token":"new-t","refreshToken":"new-r"}' }, // 刷新成功
      { status: 200, headers: {}, body: '{"ok":true}' }                          // 重放成功
    ])
    const tokens = new InMemoryTokenStore()
    await tokens.setToken('old-t')
    await tokens.setRefreshToken('old-r')
    const http = new HttpClient(transport, tokens, cfg)

    const res = await http.get<{ ok: boolean }>('/data')
    expect(res.body.ok).toBe(true)
    // 刷新后 token 写回
    expect(await tokens.getToken()).toBe('new-t')
    expect(await tokens.getRefreshToken()).toBe('new-r')
    // 重放请求带了新 token
    expect(transport.requests[2].headers.Authorization).toBe('Bearer new-t')
  })

  it('无 refreshToken 抛 auth 错误', async () => {
    const transport = new FakeTransport([{ status: 401, headers: {}, body: '' }])
    const tokens = new InMemoryTokenStore()
    await tokens.setToken('old-t') // 无 refreshToken
    const http = new HttpClient(transport, tokens, cfg)
    await expect(http.get('/x')).rejects.toMatchObject({ kind: 'auth' })
  })

  it('刷新接口失败抛 auth 错误', async () => {
    const transport = new FakeTransport([
      { status: 401, headers: {}, body: '' },
      { status: 401, headers: {}, body: '' } // 刷新也 401
    ])
    const tokens = new InMemoryTokenStore()
    await tokens.setToken('t')
    await tokens.setRefreshToken('r')
    const http = new HttpClient(transport, tokens, cfg)
    await expect(http.get('/x')).rejects.toMatchObject({ kind: 'auth' })
  })

  it('并发 401 只发一次刷新（single-flight）', async () => {
    const transport = new FakeTransport([
      { status: 401, headers: {}, body: '' },
      { status: 401, headers: {}, body: '' },
      { status: 200, headers: {}, body: '{"token":"nt","refreshToken":"nr"}' }, // 只一次刷新
      { status: 200, headers: {}, body: '{"a":1}' }, // 重放 1
      { status: 200, headers: {}, body: '{"a":2}' }  // 重放 2
    ])
    const tokens = new InMemoryTokenStore()
    await tokens.setToken('t')
    await tokens.setRefreshToken('r')
    const http = new HttpClient(transport, tokens, cfg)

    const [r1, r2] = await Promise.all([http.get('/x1'), http.get('/x2')])
    expect(r1.body).toEqual({ a: 1 })
    expect(r2.body).toEqual({ a: 2 })
    // 只发了 1 次刷新请求（index 2 是唯一的状态 200 refresh 响应）
    const refreshRequests = transport.requests.filter((r) => r.url.endsWith('/refresh'))
    expect(refreshRequests).toHaveLength(1)
  })
})
```

- [ ] **Step 3: 运行确认通过**

```bash
npx vitest run tests/http/http-client-refresh.test.ts
```

预期：PASS。并发 single-flight 测试可能对响应队列顺序敏感——若不稳定，可在 FakeTransport 用响应函数模式（按 url 区分）。先按队列跑，若 flaky 再改。

- [ ] **Step 4: 验证基线**

```bash
npm run typecheck
npm test
```

预期：typecheck 通过；`npm test` 含全部 http 单测全绿。

- [ ] **Step 5: Commit**

```bash
git add src/main/http-client/http-client.ts tests/http/http-client-refresh.test.ts
git commit -m "feat(http): 401 刷新重放与并发 single-flight"
```

---

### Task 6: 脱敏日志验证 + 集成测试

**Files:**
- Create: `tests/http/redact.test.ts`, `tests/http/integration.test.ts`

- [ ] **Step 1: 写脱敏验证测试**

`tests/http/redact.test.ts`：

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { HttpClient } from '../../src/main/http-client/http-client'
import { FakeTransport } from '../../src/main/http-client/transport'
import { InMemoryTokenStore } from '../../src/main/http-client/token-store'
import { defaultHttpConfig } from '../../src/main/http-client/config'

afterEach(() => vi.restoreAllMocks())

describe('HttpClient 脱敏', () => {
  it('错误日志不含 token 原值', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const transport = new FakeTransport([
      { status: 500, headers: {}, body: 'e' },
      { status: 500, headers: {}, body: 'e' }
    ])
    const tokens = new InMemoryTokenStore()
    await tokens.setToken('SECRET-TOKEN-VALUE')
    const http = new HttpClient(transport, tokens, { ...defaultHttpConfig(), maxRetries: 1, timeoutMs: 1000 })

    await expect(http.get('/x')).rejects.toMatchObject({ kind: 'server' })

    const logged = debugSpy.mock.calls.map((c) => String(c)).join('\n')
    expect(logged).not.toContain('SECRET-TOKEN-VALUE')
    expect(logged).not.toContain('Bearer')
  })

  it('redactHeaders 在刷新日志场景也不泄漏', async () => {
    const { redactHeaders } = await import('../../src/main/http-client/http-error')
    const r = redactHeaders({ Authorization: 'Bearer SECRET', X: 'keep' })
    expect(JSON.stringify(r)).not.toContain('SECRET')
    expect(r.X).toBe('keep')
  })
})
```

- [ ] **Step 2: 写集成测试**

`tests/http/integration.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { HttpClient } from '../../src/main/http-client/http-client'
import { FakeTransport } from '../../src/main/http-client/transport'
import { InMemoryTokenStore } from '../../src/main/http-client/token-store'
import { defaultHttpConfig } from '../../src/main/http-client/config'

describe('HttpClient 端到端', () => {
  it('GET 成功 → 401 刷新 → 重放成功', async () => {
    const cfg = { ...defaultHttpConfig(), baseUrl: 'http://api', refreshUrl: 'http://api/refresh', timeoutMs: 1000, maxRetries: 0 }
    const transport = new FakeTransport([
      { status: 200, headers: {}, body: '{"first":true}' },
      { status: 401, headers: {}, body: '' },
      { status: 200, headers: {}, body: '{"token":"t2","refreshToken":"r2"}' },
      { status: 200, headers: {}, body: '{"second":true}' }
    ])
    const tokens = new InMemoryTokenStore()
    await tokens.setToken('t1')
    await tokens.setRefreshToken('r1')
    const http = new HttpClient(transport, tokens, cfg)

    const r1 = await http.get<{ first: boolean }>('/data')
    expect(r1.body.first).toBe(true)

    const r2 = await http.get<{ second: boolean }>('/data')
    expect(r2.body.second).toBe(true)
    expect(await tokens.getToken()).toBe('t2')
  })

  it('post 带 body 正确发送', async () => {
    const transport = new FakeTransport([{ status: 201, headers: {}, body: '{"id":1}' }])
    const http = new HttpClient(transport, new InMemoryTokenStore(), { ...defaultHttpConfig(), baseUrl: 'http://api' })
    const res = await http.post<{ id: number }>('/items', { body: { name: 'x' } })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(1)
    expect(transport.requests[0].body).toBe('{"name":"x"}')
    expect(transport.requests[0].headers['Content-Type']).toBe('application/json')
  })
})
```

- [ ] **Step 3: 运行**

```bash
npx vitest run tests/http/redact.test.ts tests/http/integration.test.ts
```

预期：PASS。

- [ ] **Step 4: 验证基线**

```bash
npm run typecheck
npm test
```

预期：typecheck 通过；`npm test` 全绿（含全部 http 单测/集成/脱敏）。

- [ ] **Step 5: Commit**

```bash
git add tests/http/redact.test.ts tests/http/integration.test.ts
git commit -m "test(http): 脱敏验证与端到端集成测试"
```

---

### Task 7: IPC 契约扩展（shared）

**Files:**
- Modify: `src/shared/ipc/channels.ts`, `src/shared/ipc/api.ts`
- Create: `tests/shared/ipc/http-contract.test.ts`

- [ ] **Step 1: 扩展 channels.ts**

在 `src/shared/ipc/channels.ts` 末尾追加：

```ts
// ---- HTTP ----
export const HTTP_CHANNELS = {
  get: 'http:get',
  post: 'http:post',
  put: 'http:put',
  delete: 'http:delete',
  setToken: 'http:set-token',
  setRefreshToken: 'http:set-refresh-token',
  clearTokens: 'http:clear-tokens'
} as const

export type HttpChannelName = (typeof HTTP_CHANNELS)[keyof typeof HTTP_CHANNELS]

export const httpPathSchema = z.string().min(1)
export const httpBodySchema = z.any()
export const httpHeadersSchema = z.record(z.string(), z.string()).optional()
export const httpOptionsSchema = z.object({
  headers: httpHeadersSchema,
  body: httpBodySchema,
  timeoutMs: z.number().int().positive().optional()
}).optional()
```

- [ ] **Step 2: 扩展 api.ts**

在 `src/shared/ipc/api.ts` 加 `HttpApi` 并在 `RendererApi` 加 `http`：

```ts
export interface HttpTypedResponse<T = unknown> {
  status: number
  body: T
}

export interface HttpApi {
  get<T = unknown>(path: string, opts?: { headers?: Record<string, string>; body?: unknown; timeoutMs?: number }): Promise<HttpTypedResponse<T>>
  post<T = unknown>(path: string, opts?: { headers?: Record<string, string>; body?: unknown; timeoutMs?: number }): Promise<HttpTypedResponse<T>>
  put<T = unknown>(path: string, opts?: { headers?: Record<string, string>; body?: unknown; timeoutMs?: number }): Promise<HttpTypedResponse<T>>
  delete<T = unknown>(path: string, opts?: { headers?: Record<string, string>; body?: unknown; timeoutMs?: number }): Promise<HttpTypedResponse<T>>
  setToken(token: string): Promise<void>
  setRefreshToken(token: string): Promise<void>
  clearTokens(): Promise<void>
}

export interface RendererApi {
  ping(): Promise<{ ok: boolean }>
  getVersion(): Promise<VersionInfo>
  sdk: SdkApi
  db: DbApi
  http: HttpApi
}
```

- [ ] **Step 3: 写契约单测**

`tests/shared/ipc/http-contract.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { validate } from '../../../src/shared/ipc/validate'
import { httpPathSchema, httpOptionsSchema } from '../../../src/shared/ipc/channels'

describe('HTTP IPC 契约', () => {
  it('path 必须非空', () => {
    expect(validate(httpPathSchema, '/users')).toBe('/users')
    expect(() => validate(httpPathSchema, '')).toThrow()
  })

  it('opts 可选', () => {
    expect(validate(httpOptionsSchema, undefined)).toBeUndefined()
  })

  it('opts.headers 是字符串 record', () => {
    const opts = { headers: { Authorization: 'Bearer x' }, body: { a: 1 } }
    expect(validate(httpOptionsSchema, opts)).toEqual(opts)
  })

  it('opts.timeoutMs 必须正整数', () => {
    expect(() => validate(httpOptionsSchema, { timeoutMs: -1 })).toThrow()
    expect(() => validate(httpOptionsSchema, { timeoutMs: 1.5 })).toThrow()
  })
})
```

- [ ] **Step 4: 运行单测**

```bash
npx vitest run tests/shared/ipc/http-contract.test.ts
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc/channels.ts src/shared/ipc/api.ts tests/shared/ipc/http-contract.test.ts
git commit -m "feat(http): IPC 契约扩展（http 通道与 zod schema）"
```

> 注意：修改 `RendererApi`（加 `http`）会导致 `src/preload/index.ts` typecheck 报错——EXPECTED，Task 8 修复。

---

### Task 8: 主进程 handler、preload 与渲染验证页

**Files:**
- Modify: `src/main/ipc/register.ts`, `src/preload/index.ts`, `src/renderer/src/router.ts`
- Create: `src/renderer/src/views/HttpView.vue`
- Create: `tests/renderer/http-view.test.ts`

- [ ] **Step 1: 修改 register.ts 接入 HttpClient**

在 `src/main/ipc/register.ts` 顶部 import 加：

```ts
import { HTTP_CHANNELS, httpPathSchema, httpOptionsSchema } from '@shared/ipc/channels'
import { HttpClient } from '../http-client/http-client'
import { NetTransport } from '../http-client/transport'
import { DbTokenStore } from '../http-client/token-store'
import { DbHttpConfig } from '../http-client/config'
import { HttpError, serializeHttpError } from '../http-client/http-error'
```

在 dbClient 单例之后加 HttpClient 单例：

```ts
let httpClient: HttpClient | null = null
let httpClientPromise: Promise<HttpClient> | null = null

function ensureHttpClient(): Promise<HttpClient> {
  if (!httpClientPromise) {
    httpClientPromise = (async () => {
      const db = await ensureDbClient()
      const configStore = new DbHttpConfig(db)        // db 兼具 AppConfigStore
      const tokenStore = new DbTokenStore(db)          // db 兼具 SecretStore
      const config = await configStore.load()
      const c = new HttpClient(new NetTransport(), tokenStore, config)
      httpClient = c
      return c
    })()
  }
  return httpClientPromise
}

const wrapHttp = async <T>(fn: () => Promise<T> | T): Promise<T> => {
  try {
    return await fn()
  } catch (e) {
    throw e instanceof HttpError ? serializeHttpError(e) : e
  }
}
```

> 注：`DbHttpConfig` 和 `DbTokenStore` 把 db 当 AppConfigStore/SecretStore 用，但 DbClient（子计划 3）的方法是**同步**的（`getAppConfig: string | null`），而 AppConfigStore/SecretStore 要求 **async**（`Promise<string|null>`）；且 secret 方法名不一致（db 是 `getSecretConfig`/`setSecretConfig`，SecretStore 要 `getSecret`/`setSecret`）。故两者都需适配：
> ```ts
> const configStore = new DbHttpConfig({
>   getAppConfig: async (key) => db.getAppConfig(key),
>   setAppConfig: async (key, value) => db.setAppConfig(key, value)
> })
> const tokenStore = new DbTokenStore({
>   getSecret: async (key) => db.getSecretConfig(key),
>   setSecret: async (key, value) => db.setSecretConfig(key, value)
> })
> ```

在 `registerIpc` 内（db handler 之后）加 http handler：

```ts
  ipcMain.handle(HTTP_CHANNELS.get, (_e, path, opts) =>
    wrapHttp(async () => {
      const c = await ensureHttpClient()
      return c.get(validate(httpPathSchema, path), validate(httpOptionsSchema, opts))
    })
  )
  ipcMain.handle(HTTP_CHANNELS.post, (_e, path, opts) =>
    wrapHttp(async () => {
      const c = await ensureHttpClient()
      return c.post(validate(httpPathSchema, path), validate(httpOptionsSchema, opts))
    })
  )
  ipcMain.handle(HTTP_CHANNELS.put, (_e, path, opts) =>
    wrapHttp(async () => {
      const c = await ensureHttpClient()
      return c.put(validate(httpPathSchema, path), validate(httpOptionsSchema, opts))
    })
  )
  ipcMain.handle(HTTP_CHANNELS.delete, (_e, path, opts) =>
    wrapHttp(async () => {
      const c = await ensureHttpClient()
      return c.delete(validate(httpPathSchema, path), validate(httpOptionsSchema, opts))
    })
  )
  ipcMain.handle(HTTP_CHANNELS.setToken, (_e, token) =>
    wrapHttp(async () => {
      const c = await ensureHttpClient()
      await c.tokens.setToken(token)
    })
  )
  ipcMain.handle(HTTP_CHANNELS.setRefreshToken, (_e, token) =>
    wrapHttp(async () => {
      const c = await ensureHttpClient()
      await c.tokens.setRefreshToken(token)
    })
  )
  ipcMain.handle(HTTP_CHANNELS.clearTokens, () =>
    wrapHttp(async () => {
      const c = await ensureHttpClient()
      await c.tokens.clear()
    })
  )
```

> 注意：`c.tokens` 在 Task 4 实现时已是 `readonly`（非 private），register.ts 可直接访问。`c.config` 是 private——若 handler 需要读 config 须在 HttpClient 加 getter 或方法，但 4/6 handler 只调 get/post + tokens，不直接读 config，故无需改。

- [ ] **Step 2: 修改 preload 暴露 window.api.http**

在 `src/preload/index.ts` 的 `api` 对象加 `http`，并 import `HTTP_CHANNELS`：

```ts
import { CHANNELS, SDK_CHANNELS, DB_CHANNELS, HTTP_CHANNELS } from '@shared/ipc/channels'
```

```ts
  http: {
    get: (path, opts) => ipcRenderer.invoke(HTTP_CHANNELS.get, path, opts),
    post: (path, opts) => ipcRenderer.invoke(HTTP_CHANNELS.post, path, opts),
    put: (path, opts) => ipcRenderer.invoke(HTTP_CHANNELS.put, path, opts),
    delete: (path, opts) => ipcRenderer.invoke(HTTP_CHANNELS.delete, path, opts),
    setToken: (token) => ipcRenderer.invoke(HTTP_CHANNELS.setToken, token),
    setRefreshToken: (token) => ipcRenderer.invoke(HTTP_CHANNELS.setRefreshToken, token),
    clearTokens: () => ipcRenderer.invoke(HTTP_CHANNELS.clearTokens)
  }
```

- [ ] **Step 3: 创建 HttpView.vue**

`src/renderer/src/views/HttpView.vue`：

```vue
<script setup lang="ts">
import { ref } from 'vue'

const path = ref('/users')
const method = ref<'get' | 'post'>('get')
const result = ref('')
const error = ref('')

async function send(): Promise<void> {
  result.value = ''
  error.value = ''
  try {
    const fn = method.value === 'get' ? window.api.http.get : window.api.http.post
    const res = await fn(path.value)
    result.value = JSON.stringify(res.body, null, 2)
  } catch (e) {
    error.value = (e as { message?: string })?.message ?? String(e)
  }
}

async function setToken(): Promise<void> {
  const t = prompt('输入 token')
  if (t) await window.api.http.setToken(t)
}
</script>

<template>
  <main>
    <h1>HTTP POC</h1>
    <p v-if="error" style="color: red">{{ error }}</p>
    <select v-model="method">
      <option value="get">GET</option>
      <option value="post">POST</option>
    </select>
    <input v-model="path" placeholder="/path" />
    <button @click="send">发送</button>
    <button @click="setToken">设置 Token</button>
    <pre>{{ result }}</pre>
  </main>
</template>
```

- [ ] **Step 4: 加路由**

修改 `src/renderer/src/router.ts` 加 `HttpView` 与 `/http` 路由（同前几个 view 的模式，完整替换）。

- [ ] **Step 5: 写 HttpView 组件单测**

`tests/renderer/http-view.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import HttpView from '../../src/renderer/src/views/HttpView.vue'
import type { RendererApi } from '../../src/shared/ipc/api'

beforeEach(() => {
  window.api = {
    ping: vi.fn(),
    getVersion: vi.fn(),
    sdk: { init: vi.fn(), open: vi.fn(), startScan: vi.fn(), dispose: vi.fn(), disposeSession: vi.fn(), on: vi.fn() },
    db: { getAppConfig: vi.fn(), setAppConfig: vi.fn(), deleteAppConfig: vi.fn(), listAppConfig: vi.fn().mockResolvedValue([]), getSecretConfig: vi.fn(), setSecretConfig: vi.fn(), deleteSecretConfig: vi.fn(), listSecretConfig: vi.fn().mockResolvedValue([]) },
    http: {
      get: vi.fn().mockResolvedValue({ status: 200, body: { ok: true } }),
      post: vi.fn().mockResolvedValue({ status: 201, body: { id: 1 } }),
      put: vi.fn(),
      delete: vi.fn(),
      setToken: vi.fn().mockResolvedValue(undefined),
      setRefreshToken: vi.fn(),
      clearTokens: vi.fn()
    }
  } as unknown as RendererApi
})

describe('HttpView', () => {
  it('GET 请求返回结果', async () => {
    const wrapper = mount(HttpView, { global: { stubs: { RouterLink: true } } })
    await wrapper.find('button').trigger('click')  // 第一个按钮是"发送"
    await new Promise((r) => setTimeout(r, 10))
    expect(window.api.http.get).toHaveBeenCalledWith('/users')
    expect(wrapper.text()).toContain('ok')
  })
})
```

- [ ] **Step 6: 运行单测 + typecheck**

```bash
npx vitest run tests/renderer/http-view.test.ts
npm run typecheck
```

预期：PASS，typecheck 全清（Task 7 preload 报错已由 Step 2 修复）。

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/register.ts src/preload/index.ts src/renderer/src/views/HttpView.vue src/renderer/src/router.ts tests/renderer/http-view.test.ts
git commit -m "feat(http): 主进程 handler、preload API 与渲染验证页"
```

---

### Task 9: 入口链接与全量验证

**Files:**
- Modify: `src/renderer/src/views/HomeView.vue`

- [ ] **Step 1: HomeView 加 HTTP 入口链接**

在 `src/renderer/src/views/HomeView.vue` 的 DB POC 链接后加：

```vue
    <p><RouterLink to="/http">HTTP POC</RouterLink></p>
```

- [ ] **Step 2: 全量验证**

```bash
npm run typecheck
npm test
npm run build
```

预期：typecheck 通过；`npm test` 全绿；build 成功。

- [ ] **Step 3: 手动冲烟（可选，本子计划不跑）**

```bash
npm run dev
```

> 4/6 不跑 Electron 冲烟：net 要 Electron 运行时，且 3/6 未装 electron 二进制。运行时验证推迟 6/6。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/views/HomeView.vue
git commit -m "chore(http): HomeView 入口链接与全量验证"
```

---

## 自检记录

- **Spec 覆盖**：§3 模块结构→Task 1-5；§4 transport→Task 2；§5 重试/401→Task 4/5；§6 错误+脱敏→Task 1/6；§7 TokenStore/Config→Task 3；§8 测试→各 Task；§9 工程集成→Task 7/8/9；§10 验收→Task 9 Step 2 + Task 6 脱敏。
- **类型一致性**：HttpError 五类在 http-error.ts、translateTransportError、验收一致；HttpTransport 接口在 transport.ts、http-client.ts 用；TokenStore/HttpConfig 接口在 token-store.ts/config.ts、http-client.ts 注入、register.ts 用 DbTokenStore/DbHttpConfig；RendererApi.http 在 api.ts、preload、HttpView 一致。
- **无占位符**：所有代码块完整可执行；register.ts 的 DbHttpConfig(db)/DbTokenStore(db) 结构化类型适配有注释说明。
- **已知项 / 6/6 待办**：
  - ① NetTransport 真实集成验证推迟 6/6（4/6 用 FakeTransport 测全部编排）。
  - ② 装好 electron 二进制后移除 vitest.config.ts 的 `ELECTRON_OVERRIDE_DIST_PATH`（3/6 引入，http 测试继承该 env，但 http 测试用 FakeTransport 不依赖 net，该 env 对 http 测试无影响——仍建议 6/6 统一清理）。
  - ③ 完整 body 字段脱敏日志、electron-log 集成、日志级别——留后续（4/6 只做凭证不进日志的底线脱敏）。
  - ④ 上传/下载（stream）、私有 CA 导入、POST 幂等键——留后续。
  - ⑤ register.ts 的 HttpClient 单例失败缓存（同 DbClient）：ensureHttpClient 失败后 promise 持续 reject，6/6 须文档化或加重置。
  - ⑥ `HttpClient.tokens` 在 Task 4 即声明为 `readonly`（非 private），register.ts 直接访问，无需跨 Task 改动。
