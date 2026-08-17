/** 对外句柄：不透明 id，不含 C 指针 */
export interface Session {
  id: number
}

export interface Handle {
  id: number
}

export interface SdkConfig {
  mode: number
  logger: { level: number; prefix: string }
}

export interface SdkEvent {
  handleId: number
  eventType: number
  payload: string
}

export interface DiscoveredDevice {
  mac: string
  type: string
  version: string
  name: string
  ip: string
  mask: string
  gateway: string
  serialNumber: string
  dhcpEnabled: number
  publicVersion: string
  isActive: boolean
}
