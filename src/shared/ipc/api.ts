import type { VersionInfo } from './channels'

export interface SdkApi {
  discover(): Promise<{ mac: string; type: string; version: string; name: string; ip: string; mask: string; gateway: string; serialNumber: string; dhcpEnabled: number; publicVersion: string; isActive: boolean }[]>
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
  setConfig(config: { baseUrl: string; refreshUrl: string; timeoutMs?: number; maxRetries?: number }): Promise<void>
}

export interface AppBootstrap {
  sdkSession?: { id: number }
}

export interface UseCaseApi {
  configLoadAuth(): Promise<AppBootstrap>
}

export interface SocketApi {
  modifyIp(params: { mac: string; newIp: string; mask: string; gateway: string }): Promise<{ ok: boolean }>
}

export interface RendererApi {
  ping(): Promise<{ ok: boolean }>
  getVersion(): Promise<VersionInfo>
  sdk: SdkApi
  db: DbApi
  http: HttpApi
  socket: SocketApi
  useCase: UseCaseApi
}
