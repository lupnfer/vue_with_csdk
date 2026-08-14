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
