import type { ISdkClient, IDbClient, IHttpClient, Services } from '../../src/main/use-cases/services'
import type { Session, Handle, SdkConfig, SdkEvent } from '../../src/main/sdk-service/types'
import type { RequestOptions, TypedResponse } from '../../src/main/http-client/types'
import { InMemoryTokenStore, type TokenStore } from '../../src/main/http-client/token-store'

/** FakeSdkClient：startScan 后异步投递预设事件；记录调用；可配置抛错。 */
export class FakeSdkClient implements ISdkClient {
  readonly calls: string[] = []
  private eventsToFire: SdkEvent[] = []
  private listeners: ((e: SdkEvent) => void)[] = []
  private failOn?: string

  constructor(opts?: { failOn?: string; events?: SdkEvent[] }) {
    this.failOn = opts?.failOn
    this.eventsToFire = opts?.events ?? [
      { handleId: 1, eventType: 1, payload: '{"status":"started"}' },
      { handleId: 1, eventType: 2, payload: '{"status":"done"}' }
    ]
  }

  async init(_config: SdkConfig): Promise<Session> {
    this.calls.push('init')
    if (this.failOn === 'init') throw new Error('sdk init failed')
    return { id: 1 }
  }
  async open(_session: Session): Promise<Handle> {
    this.calls.push('open')
    if (this.failOn === 'open') throw new Error('sdk open failed')
    return { id: 1 }
  }
  async startScan(_handle: Handle): Promise<void> {
    this.calls.push('startScan')
    if (this.failOn === 'startScan') throw new Error('sdk startScan failed')
    // 异步投递事件
    setTimeout(() => {
      for (const e of this.eventsToFire) {
        for (const cb of this.listeners) cb(e)
      }
    }, 10)
  }
  async dispose(_handle: Handle): Promise<void> {
    this.calls.push('dispose')
  }
  async disposeSession(_session: Session): Promise<void> {
    this.calls.push('disposeSession')
  }
  on(_event: 'event', cb: (e: SdkEvent) => void): void {
    this.listeners.push(cb)
  }
}

/** InMemoryDbClient：内存 Map 存 app_config/secret_config；可配置抛错。 */
export class InMemoryDbClient implements IDbClient {
  private appConfig = new Map<string, string>()
  private secretConfig = new Map<string, string>()
  private failOn?: string

  constructor(opts?: { failOn?: string; appConfig?: Record<string, string>; secretConfig?: Record<string, string> }) {
    this.failOn = opts?.failOn
    if (opts?.appConfig) for (const [k, v] of Object.entries(opts.appConfig)) this.appConfig.set(k, v)
    if (opts?.secretConfig) for (const [k, v] of Object.entries(opts.secretConfig)) this.secretConfig.set(k, v)
  }

  getAppConfig(key: string): string | null {
    if (this.failOn === 'getAppConfig') throw new Error('db getAppConfig failed')
    return this.appConfig.get(key) ?? null
  }
  setAppConfig(key: string, value: string): void {
    if (this.failOn === 'setAppConfig') throw new Error('db setAppConfig failed')
    this.appConfig.set(key, value)
  }
  getSecretConfig(key: string): string | null {
    if (this.failOn === 'getSecretConfig') throw new Error('db getSecretConfig failed')
    return this.secretConfig.get(key) ?? null
  }
  setSecretConfig(key: string, value: string): void {
    if (this.failOn === 'setSecretConfig') throw new Error('db setSecretConfig failed')
    this.secretConfig.set(key, value)
  }
}

/** FailingTokenStore：包装 InMemoryTokenStore，可配置 setToken/setRefreshToken 抛错。 */
export class FailingTokenStore implements TokenStore {
  private readonly inner = new InMemoryTokenStore()
  constructor(private readonly fail: boolean) {}

  async getToken(): Promise<string | null> {
    return this.inner.getToken()
  }
  async setToken(token: string): Promise<void> {
    if (this.fail) throw new Error('http setToken failed')
    return this.inner.setToken(token)
  }
  async getRefreshToken(): Promise<string | null> {
    return this.inner.getRefreshToken()
  }
  async setRefreshToken(token: string): Promise<void> {
    if (this.fail) throw new Error('http setRefreshToken failed')
    return this.inner.setRefreshToken(token)
  }
  async clear(): Promise<void> {
    return this.inner.clear()
  }
}

/** FakeHttpClient：post 返回预设响应；tokens 是 InMemoryTokenStore；可配置抛错。 */
export class FakeHttpClient implements IHttpClient {
  readonly tokens: TokenStore
  private postResponse: unknown
  private failOn?: string

  constructor(opts?: { failOn?: string; postResponse?: unknown; failSetToken?: boolean }) {
    this.failOn = opts?.failOn
    this.postResponse = opts?.postResponse ?? { uploaded: true }
    this.tokens = new FailingTokenStore(!!opts?.failSetToken)
  }

  async get<T = unknown>(_path: string, _opts?: RequestOptions): Promise<TypedResponse<T>> {
    throw new Error('FakeHttpClient.get not implemented')
  }
  async post<T = unknown>(_path: string, _opts?: RequestOptions): Promise<TypedResponse<T>> {
    if (this.failOn === 'post') throw new Error('http post failed')
    return { status: 200, body: this.postResponse as T }
  }
}

/** 构造默认 Services（全桩）。 */
export function makeServices(opts?: {
  sdk?: ConstructorParameters<typeof FakeSdkClient>[0]
  db?: ConstructorParameters<typeof InMemoryDbClient>[0]
  http?: ConstructorParameters<typeof FakeHttpClient>[0]
}): Services {
  return {
    sdk: new FakeSdkClient(opts?.sdk),
    db: new InMemoryDbClient(opts?.db),
    http: new FakeHttpClient(opts?.http)
  }
}
