# 真实 C SDK（HWPuSDK）集成设计

- 日期：2026-08-17
- 状态：待审阅
- 需求来源：`c_sdk_lib/x64/HWPuSDK.h`（HoloSens SDC SDK）、`docs/specs/2026-08-11-code-reader-client-design.md` §4
- 上游产物：子计划 1-5（脚手架/sdk-service POC/db-service/http-client/use-cases），均已合并到 main
- 范围：真实 SDK 初始化 + 日志回调 + 二层搜索集成

## 1. 背景与目标

子计划 2/6 用 mock C 库验证了 sdk-service 架构（Koffi FFI + worker_threads + transport + 回调编组）。本子计划将真实 HWPuSDK.dll 的初始化与二层搜索功能接入，替换 mock binding（并存，通过环境变量切换）。

**目标功能（4 个）：**
- SDK 初始化（`IVS_PU_InitEx`，带 TLS 证书）
- 日志回调注册（`IVS_PU_WriteLogCallBack`，不需要登录）
- 二层搜索（`IVS_PU_DiscoveryLocalDeviceList`，发现局域网内 SDC/摄像机）
- SDK 释放 + 错误处理（`IVS_PU_Cleanup` / `GetLastError` / `GetErrorMsg`）

**明确排除：** Login/Logout、事件回调、设置项（SetValidLocalIp 等）、Multicast/IP 段搜索、其他所有非初始化/搜索/日志的接口。

**约束确认：**
- DLL 是 Windows x64（`HWPuSDK.dll`），macOS 无法加载。binding 代码写好，typecheck 验证，运行时验证推迟到 Windows 环境。
- 用 `IVS_PU_InitEx`（不用 `IVS_PU_Init`），证书参数必传。
- 证书随包打包（`resources/native/cert/`），路径固定。默认证书：`cacert.cer`/`cert.pem`/`key.pem`，密码 `715AO1FEC11AD58A`。
- mock binding 保留（macOS 测试用），real binding 新增，通过 `CRC_SDK_MODE` 环境变量切换。
- `__stdcall` 在 x64 上是空定义（x64 只有一种调用约定），Koffi 用默认即可。
- 日志回调用 Koffi Pattern B（`koffi.register`），与 mock POC 验证过的跨线程回调模式一致。

## 2. 方案选择

采用 **mock/real binding 并存 + 环境变量切换**。

| 方案 | 说明 | 结论 |
|---|---|---|
| 并存 + CRC_SDK_MODE 切换 | mock binding 保留（macOS 测试），real binding 新增（Windows 生产），`SdkBinding` 接口统一 | 采用 |
| 直接替换 mock | macOS 无法加载 real DLL，测试全挂 | 否决 |

## 3. 模块结构

```
src/main/sdk-service/
├── binding.ts                    # 现有 mock binding（保留不动）
├── real-binding.ts               # 新增：HWPuSDK.dll 的 Koffi 声明 + SdkBinding 实现
├── binding-selector.ts           # 新增：按 CRC_SDK_MODE 选 mock 或 real
├── sdk-client.ts                 # 现有（新增 discover 方法）
├── transport/...                 # 现有（保留不动）
├── workers/sdk.worker.ts         # 现有（修改：用 binding-selector + 新增 discover method）
├── errors.ts / types.ts          # 现有（types.ts 新增 DiscoveredDevice）
```

### 关键决策

- **mock/real 并存**：`CRC_SDK_MODE=mock`（默认）加载 mock binding；`CRC_SDK_MODE=real` 加载 real binding。
- **DLL 路径**：real binding 优先读 `CRC_REAL_SDK_PATH` 环境变量，回退 `c_sdk_lib/x64/HWPuSDK.dll`。
- **`__stdcall` 不指定**：x64 只有一种调用约定。
- **worker 修改最小**：`sdk.worker.ts` 用 `binding-selector` 选 binding，新增 `discover` method。

## 4. SdkBinding 统一接口

```ts
export interface SdkBinding {
  init(config: SdkInitConfig): boolean
  registerLogCallback(cb: LogCallback): boolean
  discoverLocalDevices(): DiscoveredDevice[]
  cleanup(): boolean
  getLastError(): number
  getErrorMsg(errorNo: number): string
}

export interface SdkInitConfig {
  linkMode: number           // PU_LINK_MODE_E: 0=auto, 1=manual, 3=both
  localIP: string
  localPort: number
  localTlsPort: number
  cert: {
    caCertPath: string       // cacert.cer
    certPath: string         // cert.pem
    keyPath: string          // key.pem
    keyPasswd: string        // 715AO1FEC11AD58A（默认）
    forbidRSA: boolean       // false
  }
}

export type LogCallback = (
  level: number,    // PU_SDK_LOG_LEVEL_E: 0=NOTICE ~ 6=CRITICAL
  file: string,
  line: number,
  msg: string
) => number          // 返回 0

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

> mock binding 实现相同接口（`registerLogCallback`/`discoverLocalDevices` 返回桩数据），保证 worker 路由统一。

## 5. real-binding.ts — Koffi 声明

### 5.1 类型声明

```ts
import koffi from 'koffi'

const lib = koffi.load(dllPath)

// PU_CERT_FILE_PATH_PARA_S（InitEx 证书参数）
const CertFilePathStruct = koffi.struct('PU_CERT_FILE_PATH_PARA', {
  szCACertFilePath: koffi.array('char', 512),
  szKeyFilePath: koffi.array('char', 512),
  szCertFilePath: koffi.array('char', 512),
  szKeyPasswd: koffi.array('char', 68),
  cForbidRSA: 'char',
  szReserve: koffi.array('char', 31)
})

// PU_DISCOVER_DEVICE_INFO_S（单个设备信息）
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

// PU_DISCOVER_DEVICE_LIST_S（设备列表，含 1000 个设备数组）
const DiscoverDeviceListStruct = koffi.struct('PU_DISCOVER_DEVICE_LIST', {
  ulDeviceNum: 'uint32',
  stDeviceInfo: koffi.array(DiscoverDeviceInfoStruct, 1000),  // PU_DEVICE_NUM_MAX=1000
  szReserved: koffi.array('char', 32)
})

// 回调原型
const WriteLogCallback = koffi.proto('LONG pfWriteLogCallBack(UINT logLevel, const CHAR *file, ULONG line, CHAR *logString)')
```

### 5.2 函数声明

```ts
const IVS_PU_InitEx = lib.func('BOOL IVS_PU_InitEx(ULONG ulLinkMode, CHAR *szLocalIP, ULONG ulLocalPort, ULONG ulLocalTlsPort, PU_CERT_FILE_PATH_PARA *pstCertFilePath)')
const IVS_PU_DiscoveryLocalDeviceList = lib.func('BOOL IVS_PU_DiscoveryLocalDeviceList(PU_DISCOVER_DEVICE_LIST *pstDeviceList)')
const IVS_PU_Cleanup = lib.func('BOOL IVS_PU_Cleanup()')
const IVS_PU_GetVersion = lib.func('BOOL IVS_PU_GetVersion(ULONG *pulVersion)')
const IVS_PU_GetLastError = lib.func('ULONG IVS_PU_GetLastError()')
const IVS_PU_GetErrorMsg = lib.func('const CHAR *IVS_PU_GetErrorMsg(ULONG ulErrorNo)')
const IVS_PU_WriteLogCallBack = lib.func('BOOL IVS_PU_WriteLogCallBack(pfWriteLogCallBack *pfLogCallBack)')
```

### 5.3 SdkBinding 实现

| SdkBinding 方法 | 映射到 HWPuSDK | 说明 |
|---|---|---|
| `init(config)` | `IVS_PU_InitEx(linkMode, localIP, localPort, tlsPort, certStruct)` | 全局初始化，返回 BOOL |
| `registerLogCallback(cb)` | `koffi.register(cb, koffi.pointer(WriteLogCallback))` → `IVS_PU_WriteLogCallBack(ptr)` | 注册日志回调 |
| `discoverLocalDevices()` | `IVS_PU_DiscoveryLocalDeviceList(&list)` → 解码 | 返回 DiscoveredDevice[] |
| `cleanup()` | `IVS_PU_Cleanup()` | 返回 BOOL |
| `getLastError()` | `IVS_PU_GetLastError()` | 返回错误码 |
| `getErrorMsg(no)` | `IVS_PU_GetErrorMsg(no)` | 返回字符串 |

### 5.4 关键决策

- **`pstCertFilePath` 必传**：证书结构体不能传 null。
- **`GetVersion` 传指针**：用 `koffi.alloc('uint32')` 分配，调函数后读值。
- **回调用 Pattern B**：`koffi.register(fn, koffi.pointer(proto))`。
- **`discoverLocalDevices` 解码**：读 `ulDeviceNum`，遍历 `stDeviceInfo[0..n-1]`，每个 char[] 转 string。
- **`init` 是全局的**：返回 BOOL（成功/失败），不是 session 句柄。

## 6. 日志回调

### 6.1 接口

```c
typedef LONG (CALLBACK *pfWriteLogCallBack)(
    PU_SDK_LOG_LEVEL_E enLogLevel,  // 0=NOTICE ~ 6=CRITICAL
    const CHAR *pFile,
    ULONG ulLine,
    CHAR *pcLogString
);
```

### 6.2 处理

- `init` 后自动注册默认日志回调：格式 `[SDK] [LEVEL] file:line msg` → `console.debug`。
- 回调在 SDK 内部线程触发，用 Koffi Pattern B 注册。
- 回调体只做：格式化 → `console.debug`。
- 将来如需集中到 electron-log，改为 `parentPort.postMessage` 投递到主进程。

## 7. worker 映射与数据流

### 7.1 worker method 映射

| worker method | SdkBinding 方法 | 说明 |
|---|---|---|
| `init` | `binding.init(config)` + `binding.registerLogCallback(...)` | 全局初始化 + 注册日志回调 |
| `discover` | `binding.discoverLocalDevices()` | 二层搜索（阻塞，worker 跑） |
| `cleanup` | `binding.cleanup()` | 释放 SDK |
| `getLastError` | `binding.getLastError()` | 取错误码 |

> mock 的 `open`/`start`/`release`/`close` 保留（macOS 测试用），worker 按 `CRC_SDK_MODE` 决定支持哪些 method。

### 7.2 数据流（二层搜索端到端）

```
渲染 → window.api.sdk.discover() → IPC → SdkClient.discover()
  → transport.invoke('discover') → worker → binding.discoverLocalDevices()
  → IVS_PU_DiscoveryLocalDeviceList(&list) → 解码 → DiscoveredDevice[]
  → MessagePort → SdkClient → IPC → 渲染（展示设备列表）
```

### 7.3 关键设计

- `discover` 是同步阻塞（SDK 发广播等响应，3-5 秒），在 worker 线程跑。
- 设备列表解码在 worker 内完成，返回可序列化 `DiscoveredDevice[]`。
- 日志回调在 SDK 线程触发，`console.debug`（POC）。
- 无 session/handle 管理（real 模式 init 是全局的，discover 不需要 login）。

## 8. SdkClient / IPC 契约调整

### 8.1 SdkClient 新增 discover

```ts
interface ISdkClient {
  init(config: SdkConfig): Promise<Session>
  discover(): Promise<DiscoveredDevice[]>        // 新增
  dispose(handle: Handle): Promise<void>
  disposeSession(session: Session): Promise<void>
  on(event: 'event', cb: (e: SdkEvent) => void): void
  off(event: 'event', cb: (e: SdkEvent) => void): void
}
```

### 8.2 IPC 契约扩展

`src/shared/ipc/channels.ts` 加 `sdk:discover` 通道 + `discoveredDeviceSchema`。

`src/shared/ipc/api.ts` 的 `SdkApi` 加 `discover(): Promise<DiscoveredDevice[]>`。

## 9. 错误处理

### 9.1 real-binding 内部错误

| 场景 | 检测 | 处理 |
|---|---|---|
| DLL 加载失败 | `koffi.load()` 抛错 | 抛 `SdkError(SDK_INIT_FAILED)` |
| InitEx 返回 FALSE | 返回值检查 | 读 `GetLastError()` → 抛 `SdkError(SDK_INIT_FAILED)` |
| Discovery 返回 FALSE | 返回值检查 | 读 `GetLastError()` → 抛 `SdkError(SDK_CALL_FAILED)` |
| DLL 不可加载（macOS） | `koffi.load()` 抛错 | binding-selector 抛明确错误 |

### 9.2 错误码翻译

real SDK 错误码通过 `IVS_PU_GetLastError()` 获取，`IVS_PU_GetErrorMsg()` 转成可读消息。real-binding 统一包成 `SdkError`，沿用 mock 的跨 worker 传播机制。

## 10. 证书配置

### 10.1 默认证书

| 字段 | 文件名 | 说明 |
|---|---|---|
| `szCACertFilePath` | `cacert.cer` | CA 证书 |
| `szCertFilePath` | `cert.pem` | 客户端证书 |
| `szKeyFilePath` | `key.pem` | 客户端私钥 |
| `szKeyPasswd` | `715AO1FEC11AD58A` | 私钥密码（默认证书固定） |
| `cForbidRSA` | `0` | 不禁用 RSA |

### 10.2 路径

```
c_sdk_lib/x64/
├── HWPuSDK.dll
├── cert/
│   ├── cacert.cer      ← 从 SDK 发布包 sdk/windows/lib/cert/ 复制
│   ├── cert.pem
│   └── key.pem
```

打包时 `cert/` 随 DLL 一起走 `extraResources` 进 `resources/native/cert/`。

```ts
const certDir = app.isPackaged
  ? path.join(process.resourcesPath, 'native', 'cert')
  : path.join(process.cwd(), 'c_sdk_lib', 'x64', 'cert')
```

## 11. 测试策略

### 11.1 macOS 测试（mock binding，现有测试不变）

现有 mock-sdk 测试保留不动。`CRC_SDK_MODE` 默认 "mock"。typecheck 验证 real-binding 的 Koffi 声明语法正确。

### 11.2 real-binding typecheck 验证

real-binding.ts 加入 `tsconfig.node.json` include，typecheck 验证声明语法 + `SdkBinding` 接口实现完整。

### 11.3 新增测试：binding-selector + discover 数据流

- binding-selector：`CRC_SDK_MODE=mock` 选 mock；`CRC_SDK_MODE=real` 选 real（加载失败抛明确错误）。
- discover 集成测试（mock 模式）：mock binding 加 `discoverLocalDevices()` 返回预设设备列表，验证完整链路。
- DiscoveredDevice 契约测试：zod schema 校验。

### 11.4 real-binding 运行时验证（Windows，推迟）

DLL 是 Windows x64，macOS 无法加载。运行时验证推迟到 Windows 环境。

## 12. 验收标准

- `npm run typecheck` 通过（含 real-binding.ts）。
- `npm test` 全绿（mock 模式测试 + 新增 discover/binding-selector 测试）。
- `npm run build` 成功。
- real-binding 代码就位，运行时验证文档化（Windows 环境）。
- `CRC_SDK_MODE` 切换 mock/real binding，mock 模式全部测试通过。
