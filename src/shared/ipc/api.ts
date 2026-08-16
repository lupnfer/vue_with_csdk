import type { VersionInfo } from './channels'
import type { ScanResult, AppBootstrap } from '../../main/use-cases/types'

export interface SdkConfig {
  mode: number
  logger: { level: number; prefix: string }
}

export interface SdkEvent {
  handleId: number
  eventType: number
  payload: string
}

export interface SdkApi {
  init(config: SdkConfig): Promise<{ id: number }>
  open(sessionId: number): Promise<{ id: number }>
  startScan(handleId: number): Promise<void>
  dispose(handleId: number): Promise<void>
  disposeSession(sessionId: number): Promise<void>
  on(event: 'event', cb: (e: SdkEvent) => void): () => void
}

export interface DbApi {
  getAppConfig(key: string): Promise<string | null>
  setAppConfig(key: string, value: string): Promise<void>
  deleteAppConfig(key: string): Promise<void>
  listAppConfig(): Promise<{ key: string; value: string; updatedAt: string }[]>
  getSecretConfig(key: string): Promise<string | null>
  setSecretConfig(key: string, value: string): Promise<void>
  deleteSecretConfig(key: string): Promise<void>
  listSecretConfig(): Promise<{ key: string; value: string; updatedAt: string }[]>
}

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

export interface UseCaseApi {
  scanAndUpload(params: { sdkConfig: { mode: number; logger: { level: number; prefix: string } }; uploadUrl: string }): Promise<ScanResult>
  configLoadAuth(): Promise<AppBootstrap>
}

export interface RendererApi {
  ping(): Promise<{ ok: boolean }>
  getVersion(): Promise<VersionInfo>
  sdk: SdkApi
  db: DbApi
  http: HttpApi
  useCase: UseCaseApi
}
