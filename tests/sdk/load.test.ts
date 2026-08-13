import { describe, it, expect } from 'vitest'
import koffi from 'koffi'
import { join } from 'node:path'
import { platform } from 'node:os'

const ext = platform() === 'darwin' ? 'dylib' : platform() === 'win32' ? 'dll' : 'so'
const libPath = process.env['CRC_MOCK_SDK_PATH'] ?? join(process.cwd(), `mock-sdk/build/libcrc_sdk.${ext}`)

describe('mock SDK 加载', () => {
  it('能加载库并读取版本号', () => {
    const lib = koffi.load(libPath)
    const version = lib.func('const char *crc_sdk_version(void)')
    expect(version()).toBe('crc-mock-1.0.0')
  })
})
