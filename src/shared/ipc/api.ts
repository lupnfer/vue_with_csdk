import type { VersionInfo } from './channels'

export interface RendererApi {
  ping(): Promise<{ ok: boolean }>
  getVersion(): Promise<VersionInfo>
}
