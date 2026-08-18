import { describe, it, expect } from 'vitest'

describe('binding-selector', () => {
  it('CRC_SDK_MODE=mock（默认）选 mock binding', async () => {
    delete process.env.CRC_SDK_MODE
    const { selectBinding } = await import('../../src/main/sdk-service/binding-selector')
    const binding = selectBinding()
    expect(binding.discoverDevicesByMulticast()[0].type).toContain('MOCK')
  })

  it('CRC_SDK_MODE=real 在 macOS 抛明确错误', async () => {
    process.env.CRC_SDK_MODE = 'real'
    const { selectBinding } = await import('../../src/main/sdk-service/binding-selector')
    expect(() => selectBinding()).toThrow(/real.*binding|DLL|load/i)
    delete process.env.CRC_SDK_MODE
  })
})
