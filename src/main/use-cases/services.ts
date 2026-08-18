import type { DiscoveredDevice } from '../sdk-service/types'
import type { ConfigEntry } from '../db-service/types'
import type { RequestOptions, TypedResponse } from '../http-client/types'
import type { TokenStore } from '../http-client/token-store'

export interface ISdkClient {
  discover(): Promise<DiscoveredDevice[]>
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
