export type SdkErrorCategory = 'init' | 'call' | 'callback' | 'memory' | 'unknown'

export interface RawError {
  code: number
  category: SdkErrorCategory
  raw: string
}

export class SdkError extends Error {
  readonly code: string
  readonly category: SdkErrorCategory
  readonly retryable: boolean

  constructor(code: string, category: SdkErrorCategory, message: string, retryable: boolean) {
    super(message)
    this.name = 'SdkError'
    this.code = code
    this.category = category
    this.retryable = retryable
  }
}

interface Rule {
  code: string
  retryable: boolean
}

const RULES: Record<number, Rule> = {
  [-1]: { code: 'SDK_CALL_FAILED', retryable: false },
  [-2]: { code: 'SDK_OOM', retryable: true },
  [-3]: { code: 'SDK_ALREADY_RELEASED', retryable: false }
}

export function translateError(raw: RawError): SdkError {
  const rule = RULES[raw.code] ?? { code: 'SDK_UNKNOWN', retryable: true }
  const message = `[${raw.category}] ${rule.code}: ${raw.raw} (code=${raw.code})`
  return new SdkError(rule.code, raw.category, message, rule.retryable)
}

/** 序列化形式（跨 worker MessagePort 传输） */
export interface SerializedError {
  code: string
  category: SdkErrorCategory
  message: string
  retryable: boolean
}

export function serializeError(err: SdkError): SerializedError {
  return { code: err.code, category: err.category, message: err.message, retryable: err.retryable }
}

export function deserializeError(data: SerializedError): SdkError {
  return new SdkError(data.code, data.category, data.message, data.retryable)
}
