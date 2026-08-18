import type { SdkBinding, SdkInitConfig, LogCallback, DiscoveredDevice } from './binding-interface'

export const mockBinding: SdkBinding = {
  init(_config: SdkInitConfig): boolean {
    return true
  },

  registerLogCallback(_cb: LogCallback): boolean {
    return true
  },

  discoverDevicesByMulticast(): DiscoveredDevice[] {
    return [
      {
        mac: '00:11:22:33:44:55',
        type: 'IPC-MOCK',
        version: 'V1.0-mock',
        name: 'Mock-Camera-01',
        ip: '192.168.1.100',
        mask: '255.255.255.0',
        gateway: '192.168.1.1',
        serialNumber: 'MOCK-SN-001',
        dhcpEnabled: 1,
        publicVersion: 'V500R019C30-mock',
        isActive: true
      }
    ]
  },

  cleanup(): boolean {
    return true
  },

  getLastError(): number {
    return 0
  },

  getErrorMsg(_errorNo: number): string {
    return 'mock: no error'
  }
}
