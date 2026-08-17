import { describe, it, expect } from 'vitest'
import { validate } from '../../../src/shared/ipc/validate'
import { discoveredDeviceSchema, discoveredDeviceListSchema } from '../../../src/shared/ipc/channels'

describe('SDK discover 契约', () => {
  it('DiscoveredDevice 结构校验', () => {
    const d = {
      mac: '00:11:22:33:44:55', type: 'IPC', version: 'V1', name: 'Cam', ip: '1.2.3.4',
      mask: '255.255.255.0', gateway: '1.2.3.1', serialNumber: 'SN', dhcpEnabled: 1,
      publicVersion: 'V500', isActive: true
    }
    expect(validate(discoveredDeviceSchema, d)).toEqual(d)
  })

  it('列表校验', () => {
    const list = [{ mac: 'aa', type: 'bb', version: 'cc', name: 'dd', ip: 'ee', mask: 'ff', gateway: 'gg', serialNumber: 'hh', dhcpEnabled: 0, publicVersion: 'ii', isActive: false }]
    expect(validate(discoveredDeviceListSchema, list)).toEqual(list)
  })
})
