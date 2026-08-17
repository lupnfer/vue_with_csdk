import { describe, it, expect } from 'vitest'
import type { SdkBinding, SdkInitConfig, LogCallback, DiscoveredDevice } from '../../src/main/sdk-service/binding-interface'

describe('SdkBinding 接口类型', () => {
  it('DiscoveredDevice 类型可构造', () => {
    const d: DiscoveredDevice = {
      mac: '00:11:22:33:44:55',
      type: 'IPC',
      version: 'V1.0',
      name: 'Camera-01',
      ip: '192.168.1.100',
      mask: '255.255.255.0',
      gateway: '192.168.1.1',
      serialNumber: 'SN123456',
      dhcpEnabled: 1,
      publicVersion: 'V500R019C30',
      isActive: true
    }
    expect(d.ip).toBe('192.168.1.100')
  })

  it('SdkInitConfig 包含证书', () => {
    const c: SdkInitConfig = {
      linkMode: 1,
      localIP: '0.0.0.0',
      localPort: 0,
      localTlsPort: 0,
      cert: {
        caCertPath: '/path/cacert.cer',
        certPath: '/path/cert.pem',
        keyPath: '/path/key.pem',
        keyPasswd: '715AO1FEC11AD58A',
        forbidRSA: false
      }
    }
    expect(c.cert.keyPasswd).toBe('715AO1FEC11AD58A')
  })
})
