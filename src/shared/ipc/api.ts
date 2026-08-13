import type { VersionInfo } from './channels'

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

export interface RendererApi {
  ping(): Promise<{ ok: boolean }>
  getVersion(): Promise<VersionInfo>
  sdk: SdkApi
  db: DbApi
}
