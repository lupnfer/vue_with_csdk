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
