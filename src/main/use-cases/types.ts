import type { SdkConfig, SdkEvent, Session } from '../sdk-service/types'

export interface ScanParams {
  sdkConfig: SdkConfig
  uploadUrl: string
}

export interface ScanResult {
  sessionId: number
  handleId: number
  events: SdkEvent[]
  uploaded: boolean
  uploadResponse?: unknown
}

export interface AppBootstrap {
  sdkSession?: Session
}
