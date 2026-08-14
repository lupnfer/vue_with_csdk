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

  private refreshPromise: Promise<string> | null = null

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
    let refreshed = false

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await this.backoff(attempt)
      }
      try {
        const req = await this.buildRequest(method, url, opts?.headers, body, timeoutMs)
        const res = await this.transport.send(req)
        if (res.status >= 400) {
          throw { kind: 'http', status: res.status, message: res.body || `HTTP ${res.status}` }
        }
        return { status: res.status, body: this.parseBody(res) as T }
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
            if (res.status >= 400) {
              throw { kind: 'http', status: res.status, message: res.body || `HTTP ${res.status}` }
            }
            return { status: res.status, body: this.parseBody(res) as T }
          } catch (refreshErr) {
            const replayErr = this.toHttpError(refreshErr)
            this.logError(method, path, replayErr, attempt)
            // 刷新失败（auth）或非幂等/不可重试：直接抛
            if (replayErr.kind === 'auth' || !IDEMPOTENT.has(method) || !replayErr.retryable) {
              throw replayErr
            }
            // 重放遇到可重试错误（如 5xx/网络/超时）：交回外层重试循环，不直接抛
            lastError = replayErr
            continue  // 跳过下方对原 401 的处理（否则会用不可重试的 auth 错误覆盖并抛出）
          }
        }
        lastError = err
        this.logError(method, path, err, attempt)
        if (!IDEMPOTENT.has(method) || !err.retryable) {
          throw err
        }
      }
    }
    throw lastError ?? new HttpError('network', undefined, 'exhausted retries', false)
  }

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
