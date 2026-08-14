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
