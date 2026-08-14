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
