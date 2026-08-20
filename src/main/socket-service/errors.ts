export type SocketErrorCategory = 'bind' | 'send' | 'codec' | 'unknown'

export class SocketError extends Error {
  readonly code: string
  readonly category: SocketErrorCategory
  readonly retryable: boolean

  constructor(code: string, category: SocketErrorCategory, message: string, retryable: boolean) {
    super(message)
    this.name = 'SocketError'
    this.code = code
    this.category = category
    this.retryable = retryable
  }
}

export interface SerializedSocketError {
  code: string
  category: SocketErrorCategory
  message: string
  retryable: boolean
}

export function serializeSocketError(err: SocketError): SerializedSocketError {
  return { code: err.code, category: err.category, message: err.message, retryable: err.retryable }
}

export function deserializeSocketError(data: SerializedSocketError): SocketError {
  return new SocketError(data.code, data.category, data.message, data.retryable)
}
