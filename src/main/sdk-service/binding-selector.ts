import type { SdkBinding } from './binding-interface'
import { mockBinding } from './binding'

export function selectBinding(): SdkBinding {
  const mode = process.env['CRC_SDK_MODE'] ?? 'mock'
  if (mode === 'real') {
    try {
      const { realBinding } = require('./real-binding')
      return realBinding as SdkBinding
    } catch (e) {
      throw new Error(`Failed to load real binding: ${e instanceof Error ? e.message : String(e)}. Set CRC_SDK_MODE=mock for development.`)
    }
  }
  return mockBinding
}
