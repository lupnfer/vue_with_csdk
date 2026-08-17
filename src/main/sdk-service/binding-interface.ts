export interface SdkInitConfig {
  linkMode: number
  localIP: string
  localPort: number
  localTlsPort: number
  cert: {
    caCertPath: string
    certPath: string
    keyPath: string
    keyPasswd: string
    forbidRSA: boolean
  }
}

export type LogCallback = (
  level: number,
  file: string,
  line: number,
  msg: string
) => number

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

export interface SdkBinding {
  init(config: SdkInitConfig): boolean
  registerLogCallback(cb: LogCallback): boolean
  discoverLocalDevices(): DiscoveredDevice[]
  cleanup(): boolean
  getLastError(): number
  getErrorMsg(errorNo: number): string
}
