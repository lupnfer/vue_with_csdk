import koffi from 'koffi'
import { join } from 'node:path'
import { platform } from 'node:os'

const ext = platform() === 'win32' ? 'dll' : platform() === 'darwin' ? 'dylib' : 'so'
const libPath = process.env['CRC_MOCK_SDK_PATH'] ?? join(process.cwd(), `mock-sdk/build/libcrc_sdk.${ext}`)

export const lib = koffi.load(libPath)

// 不透明句柄类型（typedef struct sdk_session sdk_session;）
export const SessionType = koffi.opaque('sdk_session')
export const HandleType = koffi.opaque('sdk_handle')

// 嵌套结构体
export const LoggerConfigStruct = koffi.struct('logger_config', {
  level: 'int',
  prefix: 'string'   // const char *
})

export const SdkConfigStruct = koffi.struct('sdk_config', {
  mode: 'int',
  logger: LoggerConfigStruct   // 嵌套
})

// 回调原型
export const ScanCallback = koffi.proto('void scan_callback(int event_type, const char *payload, void *user_data)')

// open_params
export const OpenParamsStruct = koffi.struct('open_params', {
  cb: koffi.pointer(ScanCallback),
  user_data: 'void *'
})

// 函数声明
export const crcInit = lib.func('sdk_session *crc_sdk_init(sdk_config *config)')
export const crcOpen = lib.func('sdk_handle *crc_sdk_open(sdk_session *session, open_params *params)')
export const crcStartScan = lib.func('int crc_sdk_start_scan(sdk_handle *handle)')
export const crcRelease = lib.func('int crc_sdk_release(sdk_handle *handle)')
export const crcClose = lib.func('int crc_sdk_close(sdk_session *session)')
export const crcVersion = lib.func('const char *crc_sdk_version(void)')

/**
 * 在 worker 内注册 JS 回调，返回注册 id（用于 unregister）。
 * 注意：koffi 3.1.4 的 register 要求传入 pointer-to-callback 类型
 * （PrimitiveKind::Callback），而非 proto 本身（PrimitiveKind::Prototype），
 * 故此处用 koffi.pointer(ScanCallback) 与 open_params.cb 字段类型一致。
 */
export function registerCallback(fn: (eventType: number, payload: string, userData: unknown) => void): bigint {
  return koffi.register(fn, koffi.pointer(ScanCallback))
}

export function unregisterCallback(id: bigint): void {
  koffi.unregister(id)
}

// ---- SdkBinding 兼容（mock 模式用）----

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
