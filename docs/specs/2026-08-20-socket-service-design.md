# 裸报文通信（socket-service）设计

- 日期：2026-08-20
- 状态：待审阅
- 范围：新增模块（原 6 子计划之外的增量，与 sdk-service / http-client / db-service 平级）
- 上游依赖：sdk-service（`discover` 提供设备 mac+IP）、db-service（存组播配置）

## 1. 背景与目标

修改设备 IP 功能**不走 SDK**——SDK 虽有 `IVS_PU_ModifyIPByLocalMac`，但按既定决定不用，改走 **UDP 组播裸报文**自行实现（SDK 只提供通道，不提供报文构造；且 SDK 透传通道需 Login，当前未实现，刻意不引入）。

对端（设备）的自定义二进制报文规范**已有但暂未拿到**。故本模块先搭**骨架**：UDP 组播收发 + 编解码接口（占位实现）+ 修改 IP 业务方法 + 错误处理 + IPC 暴露。**规范到后只改 `codec.ts` 一个文件**，上层不动。

**约束确认：**
- 引擎：Node `dgram`（主进程内置模块，非阻塞，vitest 可直接测，不依赖 Electron 运行时）。
- 不进 worker：UDP IO 非阻塞，无 native SDK 崩溃风险，worker 是为隔离 Koffi/SDK，此处不需要。与 `db-service` 一致，主进程单例。
- 与 SDK 完全解耦：独立 UDP socket，不经 Koffi、不共用 SDK 的组播搜索通道。
- 报文规范未到：`codec.ts` 写占位实现（通用布局），接口稳定，规范到只换内部。
- 配置：组播地址/端口存 `app_config`（key `socket_config`），复用 db-service。
- 业务串联：`discover`（SDK 组播搜索拿 mac+IP）→ `modifyIp`（裸报文改 IP）。两条组播通道独立，POC 只管"发修改指令"，不管后续 discover 列表刷新（由上层 UI 重新触发 discover）。
- UDP 不可靠：POC 不做重传/确认重试。是否需要设备应答等规范到再定（接口预留 `onMessage`）。

## 2. 方案选择

采用 **主进程直跑 + codec 接口隔离**（方案 A）。

| 方案 | 说明 | 结论 |
|---|---|---|
| A. 主进程直跑 + codec 接口 | `dgram` 在主进程单例；`codec.ts` 暴露 `encode/decode`，占位实现；UdpSocket 抽象 + Fake 桩 | 采用 |
| B. 进 worker | 仿 sdk-service 把收发放 worker_threads | 否决：UDP 非阻塞无崩溃风险，多一层 worker 通信开销，收益为负 |
| C. 复用 http-client transport | HTTP 抽象套 UDP | 否决：UDP 组播报文非 HTTP 语义，强行复用扭曲抽象 |

理由：方案 A 与 `db-service`/`http-client` 同模式（主进程 facade + 可插拔底层 + Fake 桩测试）。`dgram` 是 Node 内置模块，vitest 直接能跑（不像 `net` 要 Electron 运行时），故生产实现 `MulticastUdpSocket` 也可单测，Fake 桩主要用于隔离真实组播网络。

## 3. 模块结构

```
src/main/socket-service/
├── udp-multicast.ts   # UdpSocket 接口 + MulticastUdpSocket（dgram 生产）+ FakeUdpSocket（测试桩）
├── codec.ts           # PacketCodec 接口 + 占位实现（magic+type+length+body+crc32）；规范到替换内部
├── ip-modify.ts       # IpModifyService：modifyDeviceIp(params) → encode → send →（可选）等响应
├── errors.ts          # SocketError + serialize/deserialize（同 DbError/HttpError 模式）
└── types.ts           # IpModifyParams / IpModifyPacket / MulticastConfig / 响应类型

src/shared/ipc/channels.ts（扩展）  # SOCKET_CHANNELS + zod schema
src/shared/ipc/api.ts（扩展）       # RendererApi.socket: { modifyIp }
src/main/ipc/register.ts（扩展）    # socket handler → IpModifyService
src/preload/index.ts（扩展）        # window.api.socket.modifyIp
src/renderer/src/views/SocketView.vue + router /socket   # 验证页（输入 mac+新IP → 发指令）
tests/socket/*.test.ts                                   # 单测（FakeUdpSocket 驱动）
```

### 关键决策

- **主进程 facade 单例**：`IpModifyService` 持 `UdpSocket` + `PacketCodec`，构造注入，主进程单例（同 `SdkClient`/`DbClient`/`HttpClient`）。
- **UdpSocket 抽象**：`MulticastUdpSocket`（`dgram.createSocket('udp4')`，运行时）+ `FakeUdpSocket`（测试桩，记录 send、可注入 onMessage 响应）。`IpModifyService` 只调接口，不直接碰 dgram。
- **PacketCodec 抽象**：占位实现 + 规范到替换。`IpModifyService` 只调 `encode/decode`，不接触字节布局。
- **配置存 db**：`MulticastConfig`（groupAddr/groupPort/bindPort）存 `app_config`（key `socket_config`，JSON），未设置用默认值。
- **不进 worker**：见 §1。

### 渲染进程分工（同既有安全约束）

```
渲染进程（纯净）           preload（白名单）         主进程
  SocketView 表单           window.api.socket     →  IpModifyService.modifyDeviceIp()
  "改这个 mac 的 IP"         （只传业务意图）         ├ codec.encode(params) → Buffer
                                                     ├ udpSocket.send(buf, groupPort, groupAddr)
                                                     ├ （可选）onMessage → codec.decode → 响应
                                                     └ 返回 { ok } 或 SocketError
       ←————————————— 业务结果（无凭证）—————————————
```

渲染只发意图（mac+新IP+掩码+网关），不碰 socket、不接触报文字节。

## 4. UdpSocket 抽象

### 4.1 接口

```ts
interface UdpSocket {
  bind(port: number): Promise<void>
  addMembership(groupAddr: string, iface?: string): void
  send(buf: Buffer, port: number, addr: string): Promise<void>
  onMessage(cb: (buf: Buffer, rinfo: { address: string; port: number }) => void): void
  close(): void
}
```

### 4.2 MulticastUdpSocket（生产，dgram）

- `require('dgram').createSocket('udp4')`，`bind` 后 `addMembership` 加入组播组。
- `send` 包装成 Promise（`socket.send` 回调 resolve/reject）。
- `on('message')` 转发给注册的 cb。
- `close` 关闭 socket。
- 非 Electron 也能用：`dgram` 是 Node 内置，vitest 可直接 require。但真实组播需多机/回环环境，POC 单测主要靠 FakeUdpSocket。

### 4.3 FakeUdpSocket（测试桩）

- 构造时可选注入响应序列（模拟设备回包）。
- 记录所有 `send` 调用（buf/port/addr），供断言"发了修改指令""发到正确组播地址"。
- `onMessage` 注册后，可由测试主动触发回调模拟设备响应。
- 不碰 dgram、不碰网络。

## 5. PacketCodec 编解码（占位 + 可替换）

### 5.1 接口

```ts
interface PacketCodec {
  encode(packet: IpModifyPacket): Buffer
  decode(buf: Buffer): IpModifyPacket
}
```

### 5.2 占位实现（规范到替换）

按通用 TLV-ish 布局（**仅占位，字段待规范确认**）：

```
+--------+--------+--------+--------+--------+-------------+--------+
| magic  | ver    | type   | length (2B, body 长度) | body...     | crc32  |
| 4B     | 1B     | 1B     |        |             | 4B          |
+--------+--------+--------+--------+-------------+--------+

body（修改 IP 类型）= mac(6B) + newIp(4B) + mask(4B) + gateway(4B)
```

- `encode`：拼 header + body，算 crc32（zlib.crc32）追加。
- `decode`：校验 magic、length、crc32，不匹配抛 `SocketError(category: 'codec')`，拆出 body 字段。
- encode/decode 对称，往返一致（单测验证）。

### 5.3 替换策略（核心）

规范到后：
- 布局一致 → 只调字段偏移/类型。
- 布局完全不同 → 重写 `codec.ts` 内部，**接口（`encode/decode` 签名）不变**。
- 上层 `ip-modify.ts` / IPC / renderer / 测试**全部不动**。

这是本设计的核心价值：把"未定的报文格式"收敛到一个文件。

## 6. IpModifyService 数据流

```
modifyDeviceIp({ mac, newIp, mask, gateway })
  ├ 1. 参数校验（mac 格式、IP 合法性）
  ├ 2. codec.encode({ type: MODIFY_IP, mac, newIp, mask, gateway }) → Buffer
  ├ 3. udpSocket.send(buf, groupPort, groupAddr)
  ├ 4. （应答模式，规范到再启用）等 onMessage → codec.decode → 验证
  └ 5. 返回 { ok: true } 或抛 SocketError
```

- **默认单向模式**：发出去即返回 `{ ok: true }`（UDP 不可靠，POC 不做重传/确认）。
- **应答模式**：接口预留 `onMessage`，规范明确需要设备 ACK 时再启用等待+超时。
- mac 来自 `discover` 结果，newIp/mask/gateway 由用户在 SocketView 填写。

## 7. 错误处理

```ts
type SocketErrorCategory = 'bind' | 'send' | 'codec' | 'unknown'

class SocketError extends Error {
  readonly code: string        // 如 SOCKET_BIND_FAILED / SOCKET_SEND_FAILED / SOCKET_CODEC_CRC
  readonly category: SocketErrorCategory
  readonly retryable: boolean
}
```

| category | 触发 | retryable |
|---|---|---|
| bind | 端口占用/无权限 | true |
| send | send 失败 | true |
| codec | magic/length/crc 校验失败 | false |
| unknown | 其他 | true |

- `serializeSocketError`/`deserializeSocketError` 跨 IPC，同 DbError/HttpError 模式。
- IPC handler 捕获 `SocketError` → 序列化 → preload 透传 → 渲染拿业务语义。

## 8. 配置

```ts
interface MulticastConfig {
  groupAddr: string     // 组播组地址，默认 '239.0.0.1'（占位，规范/设备文档确认后调）
  groupPort: number     // 组播端口，默认 6000（占位）
  bindPort: number      // 本地绑定端口，默认 0（随机）
}
```

- 从 `app_config` 读（key `socket_config`，JSON）；未设置用默认值。
- 运行时可 `setConfig` 持久化（设置页，POC 可只做 db 直读写）。
- 默认值是占位，**规范/设备组播地址确认后必须更新**。

## 9. 测试策略

### 9.1 单元测试（vitest，FakeUdpSocket + 占位 codec）

- **codec**：encode→decode 往返一致；坏 magic/length/crc 抛 `SocketError('codec')`。
- **ip-modify**：`modifyDeviceIp({mac,newIp,mask,gateway})` → 断言 FakeUdpSocket 收到 `send(buf, groupPort, groupAddr)`，且 buf 经 decode 还原回原参数。
- **错误**：FakeUdpSocket.send 抛错 → `SocketError('send')`；codec.decode 坏数据 → `SocketError('codec')`。
- **序列化**：SocketError serialize/deserialize 往返。

### 9.2 dgram 真实集成（可选）

`dgram` 是 Node 内置，可起两个 socket（一个发、一个 bind+addMembership 收）做真实组播回环测试。POC 可做轻量回环验证（同机回环），跨机验证推迟手动。与 http-client 的 NetTransport 不同，这里**生产实现也能单测**。

### 9.3 测试隔离

- FakeUdpSocket 每用例新建，无状态污染。
- 不发真实组播（Fake 拦截）。
- 占位 codec 的 crc32 用 zlib，无随机性，可确定性断言。

### 9.4 测试位置

`tests/socket/**`，默认纳入 `npm test`（纯 Fake，不需构建产物、不需 Electron）。

## 10. 交付清单

- `src/main/socket-service/` — udp-multicast/codec/ip-modify/errors/types
- `src/shared/ipc/{channels,api}.ts`（扩展）— socket 契约
- `src/main/ipc/register.ts`（扩展）— socket handler
- `src/preload/index.ts`（扩展）— `window.api.socket`
- `src/renderer/src/views/SocketView.vue` + router `/socket` — 验证页
- `tests/socket/` — 单测

## 11. 验收标准

- `npm run typecheck`、`npm test`（含 socket 单测）、`npm run build` 全绿。
- `PacketCodec` 接口稳定，占位实现可被整体替换而不改上层。
- `UdpSocket` 可插拔：FakeUdpSocket 跑测试，MulticastUdpSocket 代码就位（dgram 真实回环可选）。
- `SocketError` 经 IPC 序列化透传到渲染，渲染不碰 socket/报文字节。
- 修改 IP 经 IPC 暴露到渲染（`window.api.socket.modifyIp`），渲染只发业务意图。
- **待规范项明确**：组播地址/端口默认值、报文字段布局、是否需要设备应答——规范到后只改 `codec.ts` + 配置默认值。
