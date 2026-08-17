import type { Session, Handle, SdkConfig, SdkEvent, DiscoveredDevice } from '../sdk-service/types'
import type { ConfigEntry } from '../db-service/types'
import type { RequestOptions, TypedResponse } from '../http-client/types'
import type { TokenStore } from '../http-client/token-store'

export interface ISdkClient {
  init(config: SdkConfig): Promise<Session>
  open(session: Session): Promise<Handle>
  startScan(handle: Handle): Promise<void>
  dispose(handle: Handle): Promise<void>
  disposeSession(session: Session): Promise<void>
  discover(): Promise<DiscoveredDevice[]>
  on(event: 'event', cb: (e: SdkEvent) => void): void
  off(event: 'event', cb: (e: SdkEvent) => void): void
}

export interface IDbClient {
  getAppConfig(key: string): string | null
  setAppConfig(key: string, value: string): void
  getSecretConfig(key: string): string | null
  setSecretConfig(key: string, value: string): void
}

export interface IHttpClient {
  get<T = unknown>(path: string, opts?: RequestOptions): Promise<TypedResponse<T>>
  post<T = unknown>(path: string, opts?: RequestOptions): Promise<TypedResponse<T>>
  tokens: TokenStore
}

export interface Services {
  sdk: ISdkClient
  db: IDbClient
  http: IHttpClient
}
