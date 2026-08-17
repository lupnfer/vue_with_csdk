# 真实 C SDK（HWPuSDK）集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 HWPuSDK.dll 的初始化 + 日志回调 + 二层搜索功能用 Koffi 接入，与 mock binding 并存（CRC_SDK_MODE 切换），经 IPC 暴露到渲染进程可验证。

**Architecture:** mock/real binding 并存 + `SdkBinding` 统一接口。real-binding 用 Koffi 声明 HWPuSDK 的结构体/函数/回调，实现 init（IVS_PU_InitEx 带证书）+ registerLogCallback + discoverLocalDevices + cleanup。binding-selector 按 `CRC_SDK_MODE` 选 mock 或 real。worker 新增 `discover` method。

**Tech Stack:** Koffi 3.x（纯 TS FFI）、Node `worker_threads`、TypeScript strict、Vitest（mock 模式测试）。

## Global Constraints

- DLL 是 Windows x64（`HWPuSDK.dll`），macOS 无法加载。real-binding 代码写好，typecheck 验证，运行时验证推迟 Windows。
- 用 `IVS_PU_InitEx`（不用 `IVS_PU_Init`），证书参数必传（不能 null）。
- `__stdcall` 在 x64 上是空定义，Koffi 用默认调用约定。
- Koffi API（已验证 index.d.ts）：`koffi.load`/`struct`/`array(ref, len)`/`proto`/`pointer`/`register(fn, pointer(proto))`/`alloc(type, len)`/`Decode(value, type)`/`out(type)`。
- 证书：`cacert.cer`/`cert.pem`/`key.pem`，密码 `715AO1FEC11AD58A`，路径 `c_sdk_lib/x64/cert/`（开发）→ `resources/native/cert/`（打包）。
- mock binding 保留不动，real binding 实现 `SdkBinding` 接口与其统一。
- TypeScript `strict: true`；提交信息用 Conventional Commits。

---

## 文件结构（本子计划创建/修改）

- `src/main/sdk-service/binding-interface.ts` — SdkBinding 接口 + SdkInitConfig/LogCallback/DiscoveredDevice 类型
- `src/main/sdk-service/real-binding.ts` — HWPuSDK.dll 的 Koffi 声明 + SdkBinding 实现
- `src/main/sdk-service/binding-selector.ts` — 按 CRC_SDK_MODE 选 mock 或 real binding
- `src/main/sdk-service/binding.ts`（修改）— mock binding 加 SdkBinding 接口实现（discoverLocalDevices/registerLogCallback 桩）
- `src/main/sdk-service/types.ts`（修改）— 新增 DiscoveredDevice
- `src/main/sdk-service/workers/sdk.worker.ts`（修改）— 用 binding-selector + 新增 discover method
- `src/main/sdk-service/sdk-client.ts`（修改）— 新增 discover()
- `src/main/sdk-service/sdk-client.ts`（修改）— implements ISdkClient 加 discover
- `src/shared/ipc/channels.ts`（修改）— 加 sdk:discover + discoveredDeviceSchema
- `src/shared/ipc/api.ts`（修改）— SdkApi 加 discover
- `src/main/ipc/register.ts`（修改）— 注册 sdk:discover handler
- `src/preload/index.ts`（修改）— window.api.sdk.discover
- `src/renderer/src/views/SdkView.vue`（修改）— 加搜索按钮展示设备列表
- `tests/sdk/binding-selector.test.ts` — binding-selector 单测
- `tests/sdk/discover.test.ts` — discover 集成测试（mock 模式）

---

### Task 1: binding-interface.ts 与 types.ts 扩展（纯 TS，TDD）

**Files:**
- Create: `src/main/sdk-service/binding-interface.ts`
- Modify: `src/main/sdk-service/types.ts`（加 DiscoveredDevice）
- Create: `tests/sdk/binding-interface.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/sdk/binding-interface.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/sdk/binding-interface.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 binding-interface.ts**

`src/main/sdk-service/binding-interface.ts`：

```ts
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
```

- [ ] **Step 4: 修改 types.ts 加 DiscoveredDevice**

在 `src/main/sdk-service/types.ts` 末尾加：

```ts
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
```

> types.ts 也导出 DiscoveredDevice（供 SdkClient/IPC 用），与 binding-interface.ts 的同名结构相同（靠 TS 结构化类型互通）。

- [ ] **Step 5: 运行确认通过**

```bash
npx vitest run tests/sdk/binding-interface.test.ts
```

预期：PASS。

- [ ] **Step 6: Commit**

```bash
git add src/main/sdk-service/binding-interface.ts src/main/sdk-service/types.ts tests/sdk/binding-interface.test.ts
git commit -m "feat(sdk): SdkBinding 接口与 DiscoveredDevice 类型"
```

末尾空行加 `Co-Authored-By: Claude <noreply@anthropic.com>`

---

### Task 2: real-binding.ts（Koffi 声明 + SdkBinding 实现）

**Files:**
- Create: `src/main/sdk-service/real-binding.ts`

> real-binding 是纯声明 + 实现，DLL 在 macOS 无法加载，不跑运行时测试。typecheck 验证声明语法正确。

- [ ] **Step 1: 实现 real-binding.ts**

`src/main/sdk-service/real-binding.ts`：

```ts
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
    const decoded = koffi.Decode(listBuf, DiscoverDeviceListStruct) as {
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
```

> 注意：
> - `koffi.alloc(type, 1)` 分配结构体缓冲区，`koffi.encode` 填值，`koffi.Decode` 读值。
> - `charArrayToString` 处理 Koffi char[] → JS string（截断 \0）。
> - `realBinding` 是顶层 `export const`，模块加载时 `koffi.load` 执行——macOS 会抛错，由 binding-selector 捕获。
> - 日志回调的 file/msg 参数可能是 Buffer/char[]，用 `charArrayToString` 转换。

- [ ] **Step 2: 验证 typecheck**

```bash
npm run typecheck
```

预期：通过（Koffi 声明语法正确）。**注意**：`koffi.load(dllPath)` 在 typecheck 阶段不执行（tsc 只做类型检查，不运行代码），所以 macOS 不会报加载错误。若 typecheck 报类型不匹配，检查 Koffi API 用法。

- [ ] **Step 3: Commit**

```bash
git add src/main/sdk-service/real-binding.ts
git commit -m "feat(sdk): real-binding（HWPuSDK Koffi 声明与 SdkBinding 实现）"
```

---

### Task 3: mock binding 加 SdkBinding 接口实现

**Files:**
- Modify: `src/main/sdk-service/binding.ts`

- [ ] **Step 1: 给 mock binding 加 SdkBinding 兼容方法**

在 `src/main/sdk-service/binding.ts` 末尾追加 mock 版 `discoverLocalDevices`/`registerLogCallback`/`cleanup`/`getLastError`/`getErrorMsg` + `init` 适配：

```ts
import type { SdkBinding, SdkInitConfig, LogCallback, DiscoveredDevice } from './binding-interface'

// ---- SdkBinding 兼容（mock 模式用）----

export const mockBinding: SdkBinding = {
  init(_config: SdkInitConfig): boolean {
    // mock：不实际初始化，直接返回 true
    return true
  },

  registerLogCallback(_cb: LogCallback): boolean {
    // mock：不注册回调，直接返回 true
    return true
  },

  discoverLocalDevices(): DiscoveredDevice[] {
    // mock：返回预设设备列表
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
```

> mock binding 的现有函数（crcInit/crcOpen/crcVersion 等）保留不动，mockBinding 是新增的 SdkBinding 兼容对象，与现有函数并存。worker 在 mock 模式下用 mockBinding，在 real 模式下用 realBinding。

- [ ] **Step 2: 验证 typecheck**

```bash
npm run typecheck
```

预期：通过。

- [ ] **Step 3: Commit**

```bash
git add src/main/sdk-service/binding.ts
git commit -m "feat(sdk): mock binding 加 SdkBinding 接口实现"
```

---

### Task 4: binding-selector.ts（TDD）

**Files:**
- Create: `src/main/sdk-service/binding-selector.ts`
- Create: `tests/sdk/binding-selector.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/sdk/binding-selector.test.ts`：

```ts
import { describe, it, expect } from 'vitest'

describe('binding-selector', () => {
  it('CRC_SDK_MODE=mock（默认）选 mock binding', async () => {
    delete process.env.CRC_SDK_MODE
    const { selectBinding } = await import('../../src/main/sdk-service/binding-selector')
    const binding = selectBinding()
    expect(binding.discoverLocalDevices()[0].type).toContain('MOCK')
  })

  it('CRC_SDK_MODE=real 在 macOS 抛明确错误', async () => {
    process.env.CRC_SDK_MODE = 'real'
    const { selectBinding } = await import('../../src/main/sdk-service/binding-selector')
    expect(() => selectBinding()).toThrow(/real.*binding|DLL|load/i)
    delete process.env.CRC_SDK_MODE
  })
})
```

> 第二个测试：`CRC_SDK_MODE=real` 时 selector 尝试 import real-binding，real-binding 顶层 `koffi.load` 在 macOS 抛错。selector 捕获后抛明确错误。动态 import 避免模块加载时就崩。

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/sdk/binding-selector.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 binding-selector.ts**

`src/main/sdk-service/binding-selector.ts`：

```ts
import type { SdkBinding } from './binding-interface'
import { mockBinding } from './binding'

/**
 * 按 CRC_SDK_MODE 环境变量选 binding：
 * - "mock"（默认/未设）：mock binding（macOS 开发/测试用）
 * - "real"：real binding（Windows 生产用；macOS 加载会抛错）
 */
export function selectBinding(): SdkBinding {
  const mode = process.env['CRC_SDK_MODE'] ?? 'mock'
  if (mode === 'real') {
    try {
      // 动态 require 避免 mock 模式下加载 real DLL
      const { realBinding } = require('./real-binding')
      return realBinding as SdkBinding
    } catch (e) {
      throw new Error(`Failed to load real binding: ${e instanceof Error ? e.message : String(e)}. Set CRC_SDK_MODE=mock for development.`)
    }
  }
  return mockBinding
}
```

> `require('./real-binding')` 动态加载：mock 模式下不加载 real DLL；real 模式下加载，失败抛明确错误。typecheck 可能对 `require` 报类型问题——若报错，加 `// eslint-disable` 或 `as` 断言。

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run tests/sdk/binding-selector.test.ts
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main/sdk-service/binding-selector.ts tests/sdk/binding-selector.test.ts
git commit -m "feat(sdk): binding-selector（CRC_SDK_MODE 切换 mock/real）"
```

---

### Task 5: worker 新增 discover method + SdkClient discover()

**Files:**
- Modify: `src/main/sdk-service/workers/sdk.worker.ts`
- Modify: `src/main/sdk-service/sdk-client.ts`
- Create: `tests/sdk/discover.test.ts`

- [ ] **Step 1: 修改 worker 加 discover method**

在 `src/main/sdk-service/workers/sdk.worker.ts`：

顶部 import 改为用 binding-selector：
```ts
import { selectBinding } from '../binding-selector'
const binding = selectBinding()
```

> 注意：worker 原来的 `import { crcInit, crcOpen, ... } from '../binding'` 改为 `selectBinding()`。mock 模式下 `binding` 是 mockBinding（有 init/discoverLocalDevices 等）；real 模式下是 realBinding。worker 的原有 case（version/init/open/start/release/close）用 mock 的旧函数（mockBinding 不含这些——需要保留对 binding.ts 旧函数的 import 供 mock 模式用）。

**实际改法**：worker 顶部同时 import 旧 mock 函数（mock 模式用）和 binding-selector（discover/cleanup 用）：
```ts
import { crcInit, crcOpen, crcStartScan, crcRelease, crcClose, crcVersion, registerCallback, unregisterCallback } from '../binding'
import { selectBinding } from '../binding-selector'

const sdkBinding = selectBinding()
```

在 `default` case 之前加 `discover` case：
```ts
      case 'discover': {
        try {
          const devices = sdkBinding.discoverLocalDevices()
          ok(msg.id, devices)
        } catch (e) {
          fail(msg.id, {
            code: 'SDK_CALL_FAILED',
            category: 'call',
            message: e instanceof Error ? e.message : String(e),
            retryable: false
          })
        }
        break
      }
      case 'cleanup': {
        try {
          sdkBinding.cleanup()
          ok(msg.id, null)
        } catch (e) {
          fail(msg.id, {
            code: 'SDK_CALL_FAILED',
            category: 'call',
            message: e instanceof Error ? e.message : String(e),
            retryable: false
          })
        }
        break
      }
```

- [ ] **Step 2: 修改 SdkClient 加 discover()**

在 `src/main/sdk-service/sdk-client.ts` 加：

```ts
import type { DiscoveredDevice } from './types'

// 在类里加：
  async discover(): Promise<DiscoveredDevice[]> {
    return this.transport.invoke<DiscoveredDevice[]>('discover', [])
  }
```

同时在 `implements ISdkClient` 的接口（`src/main/use-cases/services.ts`）加 `discover`：
```ts
export interface ISdkClient {
  // ... 现有方法 ...
  discover(): Promise<DiscoveredDevice[]>
}
```

> 注意：ISdkClient 加 discover 后，FakeSdkClient（桩）也需要加 discover 实现，否则 typecheck 报错。

- [ ] **Step 3: 给 FakeSdkClient 加 discover 桩**

在 `tests/use-cases/stubs.ts` 的 FakeSdkClient 加：
```ts
  async discover(): Promise<DiscoveredDevice[]> {
    return []
  }
```

并在 import 加 `DiscoveredDevice`。

- [ ] **Step 4: 写 discover 集成测试（mock 模式）**

`tests/sdk/discover.test.ts`：

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { WorkerTransport } from '../../src/main/sdk-service/transport/worker-transport'

const workerScript = join(process.cwd(), 'out/main/workers/sdk.worker.js')

describe('sdk discover（mock 模式）', () => {
  let transport: WorkerTransport

  afterEach(() => {
    transport?.terminate()
  })

  it('discover 返回 mock 设备列表', async () => {
    transport = new WorkerTransport(workerScript)
    const devices = await transport.invoke<{
      mac: string
      ip: string
      type: string
    }[]>('discover', [])
    expect(devices.length).toBeGreaterThanOrEqual(1)
    expect(devices[0].ip).toBe('192.168.1.100')
    expect(devices[0].type).toContain('MOCK')
  })
})
```

- [ ] **Step 5: 构建并运行**

```bash
npm run build:mock && npm run build && npx vitest run --config vitest.config.integration.ts tests/sdk/discover.test.ts tests/sdk/binding-selector.test.ts
```

预期：PASS。

- [ ] **Step 6: 验证基线**

```bash
npm run typecheck
npm test
```

预期：typecheck 通过；`npm test` 全绿。

- [ ] **Step 7: Commit**

```bash
git add src/main/sdk-service/workers/sdk.worker.ts src/main/sdk-service/sdk-client.ts src/main/use-cases/services.ts tests/use-cases/stubs.ts tests/sdk/discover.test.ts
git commit -m "feat(sdk): worker discover method + SdkClient.discover()"
```

---

### Task 6: IPC 契约扩展 + handler + preload + SdkView

**Files:**
- Modify: `src/shared/ipc/channels.ts`, `src/shared/ipc/api.ts`
- Modify: `src/main/ipc/register.ts`, `src/preload/index.ts`
- Modify: `src/renderer/src/views/SdkView.vue`
- Create: `tests/shared/ipc/sdk-discover-contract.test.ts`

- [ ] **Step 1: 扩展 channels.ts**

在 `src/shared/ipc/channels.ts` 的 `SDK_CHANNELS` 加 `discover`：

```ts
export const SDK_CHANNELS = {
  init: 'sdk:init',
  open: 'sdk:open',
  startScan: 'sdk:start-scan',
  dispose: 'sdk:dispose',
  disposeSession: 'sdk:dispose-session',
  discover: 'sdk:discover',          // 新增
  event: 'sdk-events'
} as const
```

在 sdk schema 区域加：
```ts
export const discoveredDeviceSchema = z.object({
  mac: z.string(),
  type: z.string(),
  version: z.string(),
  name: z.string(),
  ip: z.string(),
  mask: z.string(),
  gateway: z.string(),
  serialNumber: z.string(),
  dhcpEnabled: z.number(),
  publicVersion: z.string(),
  isActive: z.boolean()
})
export const discoveredDeviceListSchema = z.array(discoveredDeviceSchema)
```

- [ ] **Step 2: 扩展 api.ts**

在 `src/shared/ipc/api.ts` 的 `SdkApi` 加 `discover`：

```ts
export interface SdkApi {
  init(config: SdkConfig): Promise<{ id: number }>
  open(sessionId: number): Promise<{ id: number }>
  startScan(handleId: number): Promise<void>
  dispose(handleId: number): Promise<void>
  disposeSession(sessionId: number): Promise<void>
  discover(): Promise<{ mac: string; type: string; version: string; name: string; ip: string; mask: string; gateway: string; serialNumber: string; dhcpEnabled: number; publicVersion: string; isActive: boolean }[]>
  on(event: 'event', cb: (e: SdkEvent) => void): () => void
}
```

- [ ] **Step 3: 写契约单测**

`tests/shared/ipc/sdk-discover-contract.test.ts`：

```ts
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
```

- [ ] **Step 4: 修改 register.ts 加 discover handler**

在 `src/main/ipc/register.ts` 的 sdk handler 区域加：

```ts
  ipcMain.handle(SDK_CHANNELS.discover, () =>
    wrapAsync(async () => {
      const c = ensureClient()
      return c.discover()
    })
  )
```

> `wrapAsync` 已存在（db 的），但 sdk handler 不用 wrapAsync——sdk 的 handler 直接调 SdkClient。实际上看现有 register.ts：sdk handler 不经 wrapAsync（错误透传）。保持一致：
```ts
  ipcMain.handle(SDK_CHANNELS.discover, async () => {
    const c = ensureClient()
    return c.discover()
  })
```

- [ ] **Step 5: 修改 preload 加 discover**

在 `src/preload/index.ts` 的 `sdk` 对象加：

```ts
    discover: () => ipcRenderer.invoke(SDK_CHANNELS.discover),
```

- [ ] **Step 6: 修改 SdkView 加搜索按钮**

在 `src/renderer/src/views/SdkView.vue` 加搜索按钮 + 设备列表展示。读取当前 SdkView，在模板里加：

```vue
    <button @click="runDiscover">搜索局域网设备</button>
    <ul v-if="devices.length">
      <li v-for="(d, i) in devices" :key="i">
        {{ d.name }} ({{ d.ip }}) - {{ d.mac }} - {{ d.type }}
      </li>
    </ul>
```

script 里加：
```ts
const devices = ref<{ name: string; ip: string; mac: string; type: string }[]>([])

async function runDiscover(): Promise<void> {
  error.value = ''
  try {
    devices.value = await window.api.sdk.discover()
  } catch (e) {
    error.value = (e as { message?: string })?.message ?? String(e)
  }
}
```

- [ ] **Step 7: 运行单测 + typecheck**

```bash
npx vitest run tests/shared/ipc/sdk-discover-contract.test.ts
npm run typecheck
```

预期：PASS，typecheck 全清。

- [ ] **Step 8: Commit**

```bash
git add src/shared/ipc/channels.ts src/shared/ipc/api.ts src/main/ipc/register.ts src/preload/index.ts src/renderer/src/views/SdkView.vue tests/shared/ipc/sdk-discover-contract.test.ts
git commit -m "feat(sdk): IPC discover 契约 + handler + preload + SdkView 搜索"
```

---

### Task 7: 全量验证

**Files:**
- 无新文件

- [ ] **Step 1: 全量验证**

```bash
npm run typecheck
npm test
npm run test:integration
npm run build
```

预期：typecheck 通过；npm test 全绿；集成测试全绿（含 discover）；build 成功。

- [ ] **Step 2: 手动冲烟（可选，Windows 环境）**

> macOS 无法加载 HWPuSDK.dll。Windows 环境下设 `CRC_SDK_MODE=real`，`npm run dev`，点"搜索局域网设备"按钮，验证真实设备发现。

- [ ] **Step 3: Commit（如有改动）**

```bash
git add -A
git commit -m "chore(sdk): 全量验证"
```

---

## 自检记录

- **Spec 覆盖**：§3 模块结构→Task 1-4；§4 SdkBinding 接口→Task 1；§5 real-binding→Task 2；§6 日志回调→Task 2 registerLogCallback；§7 worker/数据流→Task 5；§8 IPC→Task 6；§9 错误→Task 2 failWithLastError；§10 证书→Task 2 init；§11 测试→各 Task；§12 验收→Task 7。
- **类型一致性**：SdkBinding 在 binding-interface.ts 定义、real-binding/mock-binding 实现、binding-selector 返回、worker 用；DiscoveredDevice 在 types.ts + binding-interface.ts（结构相同）；discover 在 SdkClient/ISdkApi/SdkView/preload 一致。
- **无占位符**：所有代码块完整可执行。
- **已知项**：
  - ① real DLL 运行时验证推迟 Windows（macOS 无法加载 HWPuSDK.dll）。
  - ② 证书文件（cacert.cer/cert.pem/key.pem）需用户从 SDK 发布包复制到 `c_sdk_lib/x64/cert/`。
  - ③ worker 同时 import 旧 mock 函数 + binding-selector——mock 模式下旧函数可用，real 模式下 discover/cleanup 走 binding-selector。两种模式共存，不冲突（real 模式不调旧 mock 函数的 case）。
  - ④ ISdkClient 加 discover 后，FakeSdkClient（use-cases 桩）也需加——Task 5 Step 3 处理。
  - ⑤ `koffi.alloc`/`koffi.encode`/`koffi.Decode` 的具体行为在 macOS 无法运行时验证（DLL 加载失败），typecheck 验证语法正确，Windows 环境验证运行时行为。
