import koffi from 'koffi'
import { join } from 'node:path'
import { platform } from 'node:os'
import type { SdkBinding, SdkInitConfig, LogCallback, DiscoveredDevice } from './binding-interface'
import { SdkError } from './errors'

const dllPath = process.env['CRC_REAL_SDK_PATH'] ?? join(process.cwd(), 'c_sdk_lib', 'x64', 'HWPuSDK.dll')

// 加载 DLL（macOS 会抛错——由 binding-selector 捕获）
const lib = koffi.load(dllPath)

// ---- 类型声明 ----

const CertFilePathStruct = koffi.struct('PU_CERT_FILE_PATH_PARA', {
  szCACertFilePath: koffi.array('char', 512),
  szKeyFilePath: koffi.array('char', 512),
  szCertFilePath: koffi.array('char', 512),
  szKeyPasswd: koffi.array('char', 68),
  cForbidRSA: 'char',
  szReserve: koffi.array('char', 31)
})

const DiscoverDeviceInfoStruct = koffi.struct('PU_DISCOVER_DEVICE_INFO', {
  szDeviceMac: koffi.array('char', 30),
  szDeviceType: koffi.array('char', 32),
  szDeviceVersion: koffi.array('char', 32),
  szDeviceName: koffi.array('char', 32),
  szDeviceIp: koffi.array('char', 16),
  szDeviceMask: koffi.array('char', 16),
  szDeviceGateway: koffi.array('char', 16),
  szSerialNumber: koffi.array('char', 32),
  uDhcpEnable: 'uint32',
  cMeshIndex: 'char',
  cLocalMeshIndex: 'char',
  cOMEnable: 'char',
  szPublicVersion: koffi.array('char', 28),
  isActiveSign: 'char'
})

const DiscoverDeviceListStruct = koffi.struct('PU_DISCOVER_DEVICE_LIST', {
  ulDeviceNum: 'uint32',
  stDeviceInfo: koffi.array(DiscoverDeviceInfoStruct, 1000),
  szReserved: koffi.array('char', 32)
})

const WriteLogCallbackProto = koffi.proto('LONG pfWriteLogCallBack(UINT logLevel, const CHAR *file, ULONG line, CHAR *logString)')

// ---- 函数声明 ----

const IVS_PU_InitEx = lib.func('BOOL IVS_PU_InitEx(ULONG ulLinkMode, CHAR *szLocalIP, ULONG ulLocalPort, ULONG ulLocalTlsPort, PU_CERT_FILE_PATH_PARA *pstCertFilePath)')
const IVS_PU_DiscoveryLocalDeviceList = lib.func('BOOL IVS_PU_DiscoveryLocalDeviceList(PU_DISCOVER_DEVICE_LIST *pstDeviceList)')
const IVS_PU_Cleanup = lib.func('BOOL IVS_PU_Cleanup()')
const IVS_PU_GetVersion = lib.func('BOOL IVS_PU_GetVersion(ULONG *pulVersion)')
const IVS_PU_GetLastError = lib.func('ULONG IVS_PU_GetLastError()')
const IVS_PU_GetErrorMsg = lib.func('const CHAR *IVS_PU_GetErrorMsg(ULONG ulErrorNo)')
const IVS_PU_WriteLogCallBack = lib.func('BOOL IVS_PU_WriteLogCallBack(pfWriteLogCallBack *pfLogCallBack)')

// ---- SdkBinding 实现 ----

function charArrayToString(arr: unknown): string {
  // Koffi char[] 解码为 string，截断于第一个 \0
  if (typeof arr === 'string') return arr.replace(/\0.*$/, '')
  return String(arr ?? '').replace(/\0.*$/, '')
}

export const realBinding: SdkBinding = {
  init(config: SdkInitConfig): boolean {
    const cert = koffi.alloc(CertFilePathStruct, 1)
    koffi.encode(cert, CertFilePathStruct, {
      szCACertFilePath: config.cert.caCertPath,
      szKeyFilePath: config.cert.keyPath,
      szCertFilePath: config.cert.certPath,
      szKeyPasswd: config.cert.keyPasswd,
      cForbidRSA: config.cert.forbidRSA ? 1 : 0,
      szReserve: ''
    })
    const result = IVS_PU_InitEx(config.linkMode, config.localIP, config.localPort, config.localTlsPort, cert) as number
    return result !== 0
  },

  registerLogCallback(cb: LogCallback): boolean {
    const wrapped = (level: number, file: string, line: number, msg: string): number => {
      cb(level, charArrayToString(file), line, charArrayToString(msg))
      return 0
    }
    const ptr = koffi.register(wrapped, koffi.pointer(WriteLogCallbackProto))
    const result = IVS_PU_WriteLogCallBack(ptr) as number
    return result !== 0
  },

  discoverLocalDevices(): DiscoveredDevice[] {
    const listBuf = koffi.alloc(DiscoverDeviceListStruct, 1)
    const result = IVS_PU_DiscoveryLocalDeviceList(listBuf) as number
    if (result === 0) {
      const code = IVS_PU_GetLastError() as number
      const msg = charArrayToString(IVS_PU_GetErrorMsg(code))
      throw new SdkError('SDK_CALL_FAILED', 'call', `discovery failed: ${msg} (code=${code})`, false)
    }
    const decoded = koffi.decode(listBuf, DiscoverDeviceListStruct) as {
      ulDeviceNum: number
      stDeviceInfo: Array<Record<string, unknown>>
    }
    const count = Math.min(decoded.ulDeviceNum, 1000)
    const devices: DiscoveredDevice[] = []
    for (let i = 0; i < count; i++) {
      const d = decoded.stDeviceInfo[i]
      devices.push({
        mac: charArrayToString(d?.szDeviceMac),
        type: charArrayToString(d?.szDeviceType),
        version: charArrayToString(d?.szDeviceVersion),
        name: charArrayToString(d?.szDeviceName),
        ip: charArrayToString(d?.szDeviceIp),
        mask: charArrayToString(d?.szDeviceMask),
        gateway: charArrayToString(d?.szDeviceGateway),
        serialNumber: charArrayToString(d?.szSerialNumber),
        dhcpEnabled: (d?.uDhcpEnable as number) ?? 0,
        publicVersion: charArrayToString(d?.szPublicVersion),
        isActive: (d?.isActiveSign as number) !== 0
      })
    }
    return devices
  },

  cleanup(): boolean {
    const result = IVS_PU_Cleanup() as number
    return result !== 0
  },

  getLastError(): number {
    return IVS_PU_GetLastError() as number
  },

  getErrorMsg(errorNo: number): string {
    return charArrayToString(IVS_PU_GetErrorMsg(errorNo))
  }
}
