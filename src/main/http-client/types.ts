export interface RequestOptions {
  headers?: Record<string, string>
  body?: unknown        // 会被 JSON.stringify
  timeoutMs?: number
}

export interface TypedResponse<T = unknown> {
  status: number
  body: T
}
