# socket-service 实施计划（裸报文 UDP 组播修改 IP）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 socket-service 骨架——UDP 组播收发（`UdpSocket` 抽象 + `FakeUdpSocket` 桩）+ 自定义二进制报文编解码（`PacketCodec` 占位实现，规范到替换）+ 修改 IP 业务方法（`IpModifyService`）+ `SocketError` 分类 + IPC 暴露，经渲染进程可验证。对端报文规范未到，`codec.ts` 留可替换接口。

**Architecture:** 主进程直跑 + codec 接口隔离（方案 A）。`IpModifyService` 持 `UdpSocket` + `PacketCodec` + `MulticastConfig`，构造注入，主进程单例（同 `DbClient`/`HttpClient`）。`UdpSocket` 抽象收发（`MulticastUdpSocket` 用 dgram，`FakeUdpSocket` 测试桩）；`PacketCodec` 抽象编解码（`PlaceholderCodec` 通用布局，规范到只换内部）。与 SDK 完全解耦，不进 worker。

**Tech Stack:** Node `dgram`（主进程内置）、Node `zlib`（无——crc32 手写标准表，不引依赖）、zod（IPC 契约）、Vitest（单测，`FakeUdpSocket` 驱动，jsdom 可跑）。

## Global Constraints

- vitest 为 jsdom 环境；socket 测试用 `FakeUdpSocket`（不 `require('dgram')`），默认纳入 `npm test`。`MulticastUdpSocket` 代码就位但不单测（真实 dgram 回环推迟手动，同 `NetTransport` 策略）。
- TypeScript `strict: true`；IPC 契约只定义在 `src/shared/`。
- `dgram` 用 `require('dgram')` 动态取（同 `NetTransport` 取 net 的模式），非 Node 环境理论不可用，但主进程必为 Node。
- crc32 手写标准表格实现，不引入 npm 包，不依赖 Node 版本特性。
- 报文布局是**占位**（magic+ver+type+length+body+crc32），规范到后只改 `codec.ts` 内部，接口不变，上层不动。
- 组播地址/端口默认值占位（`239.0.0.1:6000`），规范/设备文档确认后更新 `register.ts` 默认值。
- 修改 IP 默认单向模式（发出去即返回 `{ ok: true }`），不做重传/确认；应答模式接口预留（`onMessage`）。
- 提交信息用 Conventional Commits。

---

## 文件结构（本计划创建/修改）

- `src/main/socket-service/types.ts` — IpModifyParams / IpModifyPacket / MulticastConfig / IpModifyResult
- `src/main/socket-service/errors.ts` — SocketError + serialize/deserialize
- `src/main/socket-service/codec.ts` — PacketCodec 接口 + PlaceholderCodec（crc32 手写）+ mac/ip 与字节互转
- `src/main/socket-service/udp-multicast.ts` — UdpSocket 接口 + MulticastUdpSocket（dgram）+ FakeUdpSocket（测试桩）
- `src/main/socket-service/ip-modify.ts` — IpModifyService（校验 + encode + send + 错误翻译）
- `src/shared/ipc/channels.ts`（修改）— SOCKET_CHANNELS + ipModifyParamsSchema
- `src/shared/ipc/api.ts`（修改）— RendererApi.socket
- `src/main/ipc/register.ts`（修改）— socket handler
- `src/preload/index.ts`（修改）— window.api.socket
- `src/renderer/src/views/SocketView.vue` + `router.ts`（修改）— 验证页
- `src/renderer/src/views/HomeView.vue`（修改）— 入口链接
- `tests/socket/*.test.ts` — 单测

---

### Task 1: types.ts + errors.ts（纯 TS，TDD）

**Files:**
- Create: `src/main/socket-service/types.ts`
- Create: `src/main/socket-service/errors.ts`
- Create: `tests/socket/errors.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/socket/errors.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { SocketError, serializeSocketError, deserializeSocketError } from '../../src/main/socket-service/errors'

describe('SocketError', () => {
  it('构造保留 code/category/retryable', () => {
    const err = new SocketError('SOCKET_SEND_FAILED', 'send', 'boom', true)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('SocketError')
    expect(err.code).toBe('SOCKET_SEND_FAILED')
    expect(err.category).toBe('send')
    expect(err.retryable).toBe(true)
    expect(err.message).toBe('boom')
  })

  it('serialize/deserialize 往返一致', () => {
    const err = new SocketError('SOCKET_CODEC_CRC', 'codec', 'crc mismatch', false)
    const restored = deserializeSocketError(serializeSocketError(err))
    expect(restored).toBeInstanceOf(SocketError)
    expect(restored.code).toBe('SOCKET_CODEC_CRC')
    expect(restored.category).toBe('codec')
    expect(restored.retryable).toBe(false)
    expect(restored.message).toBe('crc mismatch')
  })
})
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/socket/errors.test.ts
```
预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 types.ts**

`src/main/socket-service/types.ts`：

```ts
export interface IpModifyParams {
  mac: string // '00:11:22:33:44:55'
  newIp: string // '192.168.1.100'
  mask: string // '255.255.255.0'
  gateway: string // '192.168.1.1'
}

/** 报文类型码（占位，规范到后调整） */
export const PACKET_TYPE_MODIFY_IP = 0x01 as const

export interface IpModifyPacket {
  type: number
  mac: string
  newIp: string
  mask: string
  gateway: string
}

export interface MulticastConfig {
  groupAddr: string
  groupPort: number
  bindPort: number
}

export interface IpModifyResult {
  ok: boolean
}
```

- [ ] **Step 4: 实现 errors.ts**

`src/main/socket-service/errors.ts`：

```ts
export type SocketErrorCategory = 'bind' | 'send' | 'codec' | 'unknown'

export class SocketError extends Error {
  readonly code: string
  readonly category: SocketErrorCategory
  readonly retryable: boolean

  constructor(code: string, category: SocketErrorCategory, message: string, retryable: boolean) {
    super(message)
    this.name = 'SocketError'
    this.code = code
    this.category = category
    this.retryable = retryable
  }
}

export interface SerializedSocketError {
  code: string
  category: SocketErrorCategory
  message: string
  retryable: boolean
}

export function serializeSocketError(err: SocketError): SerializedSocketError {
  return { code: err.code, category: err.category, message: err.message, retryable: err.retryable }
}

export function deserializeSocketError(data: SerializedSocketError): SocketError {
  return new SocketError(data.code, data.category, data.message, data.retryable)
}
```

- [ ] **Step 5: 运行确认通过**

```bash
npx vitest run tests/socket/errors.test.ts
```
预期：PASS。

- [ ] **Step 6: 提交**

```bash
git add src/main/socket-service/types.ts src/main/socket-service/errors.ts tests/socket/errors.test.ts
git commit -m "feat(socket-service): add types and SocketError"
```

---

### Task 2: codec.ts（占位编解码，TDD）

**Files:**
- Create: `src/main/socket-service/codec.ts`
- Create: `tests/socket/codec.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/socket/codec.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { PlaceholderCodec } from '../../src/main/socket-service/codec'
import { SocketError } from '../../src/main/socket-service/errors'
import { PACKET_TYPE_MODIFY_IP } from '../../src/main/socket-service/types'

const codec = new PlaceholderCodec()

describe('PlaceholderCodec', () => {
  const packet = {
    type: PACKET_TYPE_MODIFY_IP,
    mac: '00:11:22:33:44:55',
    newIp: '192.168.1.100',
    mask: '255.255.255.0',
    gateway: '192.168.1.1'
  }

  it('encode/decode 往返一致', () => {
    const buf = codec.encode(packet)
    expect(buf).toBeInstanceOf(Buffer)
    const restored = codec.decode(buf)
    expect(restored).toEqual(packet)
  })

  it('encode 后字节长度 = 4(magic)+1(ver)+1(type)+2(len)+18(body)+4(crc) = 30', () => {
    const buf = codec.encode(packet)
    // body = mac 6 + newIp 4 + mask 4 + gateway 4 = 18
    expect(buf.length).toBe(4 + 1 + 1 + 2 + 18 + 4)
  })

  it('坏 magic 抛 SocketError(codec)', () => {
    const buf = codec.encode(packet)
    const bad = Buffer.from(buf)
    bad[0] = 0x00 // 破 magic
    expect(() => codec.decode(bad)).toThrow(SocketError)
    try { codec.decode(bad) } catch (e) {
      expect((e as SocketError).category).toBe('codec')
    }
  })

  it('坏 crc 抛 SocketError(codec)', () => {
    const buf = codec.encode(packet)
    const bad = Buffer.from(buf)
    bad[bad.length - 1] ^= 0xff // 破 crc
    expect(() => codec.decode(bad)).toThrow(SocketError)
    try { codec.decode(bad) } catch (e) {
      expect((e as SocketError).category).toBe('codec')
    }
  })

  it('length 不匹配抛 SocketError(codec)', () => {
    const buf = codec.encode(packet)
    const bad = Buffer.from(buf)
    bad.writeUInt16BE(99, 6) // 破 length 字段（偏移 6）
    expect(() => codec.decode(bad)).toThrow(SocketError)
  })
})
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/socket/codec.test.ts
```
预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 codec.ts**

`src/main/socket-service/codec.ts`：

```ts
import { SocketError } from './errors'
import type { IpModifyPacket } from './types'

/**
 * 报文编解码抽象。规范到后只替换 PlaceholderCodec 内部，接口不变。
 * 占位布局（big-endian）：
 *   magic(4B) + ver(1B) + type(1B) + length(2B, body 字节数) + body + crc32(4B)
 * body（修改 IP）= mac(6B) + newIp(4B) + mask(4B) + gateway(4B)
 */
export interface PacketCodec {
  encode(packet: IpModifyPacket): Buffer
  decode(buf: Buffer): IpModifyPacket
}

const MAGIC = Buffer.from([0x48, 0x57, 0x53, 0x4f]) // 'HWSO'
const VERSION = 0x01
const HEADER_LEN = 4 + 1 + 1 + 2
const CRC_LEN = 4

// ---- crc32 标准表格实现（不引依赖） ----
const CRC_TABLE: number[] = (() => {
  const table = new Array<number>(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// ---- mac / ip 与字节互转 ----
function macToBytes(mac: string): Buffer {
  const parts = mac.split(':')
  if (parts.length !== 6) throw new SocketError('SOCKET_CODEC_MAC', 'codec', `bad mac: ${mac}`, false)
  const buf = Buffer.alloc(6)
  for (let i = 0; i < 6; i++) {
    const b = parseInt(parts[i], 16)
    if (Number.isNaN(b)) throw new SocketError('SOCKET_CODEC_MAC', 'codec', `bad mac byte: ${parts[i]}`, false)
    buf[i] = b
  }
  return buf
}

function bytesToMac(buf: Buffer): string {
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join(':')
}

function ipToBytes(ip: string): Buffer {
  const parts = ip.split('.')
  if (parts.length !== 4) throw new SocketError('SOCKET_CODEC_IP', 'codec', `bad ip: ${ip}`, false)
  const buf = Buffer.alloc(4)
  for (let i = 0; i < 4; i++) {
    const n = Number(parts[i])
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      throw new SocketError('SOCKET_CODEC_IP', 'codec', `bad ip byte: ${parts[i]}`, false)
    }
    buf[i] = n
  }
  return buf
}

function bytesToIp(buf: Buffer): string {
  return Array.from(buf).join('.')
}

export class PlaceholderCodec implements PacketCodec {
  encode(packet: IpModifyPacket): Buffer {
    const body = Buffer.concat([
      macToBytes(packet.mac),
      ipToBytes(packet.newIp),
      ipToBytes(packet.mask),
      ipToBytes(packet.gateway)
    ])
    const header = Buffer.alloc(HEADER_LEN)
    MAGIC.copy(header, 0)
    header[4] = VERSION
    header[5] = packet.type & 0xff
    header.writeUInt16BE(body.length, 6)
    const withoutCrc = Buffer.concat([header, body])
    const crc = Buffer.alloc(CRC_LEN)
    crc.writeUInt32BE(crc32(withoutCrc), 0)
    return Buffer.concat([withoutCrc, crc])
  }

  decode(buf: Buffer): IpModifyPacket {
    if (buf.length < HEADER_LEN + CRC_LEN) {
      throw new SocketError('SOCKET_CODEC_LEN', 'codec', `buffer too short: ${buf.length}`, false)
    }
    const magic = buf.subarray(0, 4)
    if (!magic.equals(MAGIC)) {
      throw new SocketError('SOCKET_CODEC_MAGIC', 'codec', 'magic mismatch', false)
    }
    const type = buf[5]
    const bodyLen = buf.readUInt16BE(6)
    if (buf.length !== HEADER_LEN + bodyLen + CRC_LEN) {
      throw new SocketError('SOCKET_CODEC_LEN', 'codec', `length mismatch: header says ${bodyLen}`, false)
    }
    const withoutCrc = buf.subarray(0, HEADER_LEN + bodyLen)
    const expectedCrc = buf.readUInt32BE(HEADER_LEN + bodyLen)
    if (crc32(withoutCrc) !== expectedCrc) {
      throw new SocketError('SOCKET_CODEC_CRC', 'codec', 'crc mismatch', false)
    }
    const body = buf.subarray(HEADER_LEN, HEADER_LEN + bodyLen)
    // body = mac(6) + newIp(4) + mask(4) + gateway(4) = 18
    if (bodyLen !== 18) {
      throw new SocketError('SOCKET_CODEC_BODY', 'codec', `unexpected body length: ${bodyLen}`, false)
    }
    return {
      type,
      mac: bytesToMac(body.subarray(0, 6)),
      newIp: bytesToIp(body.subarray(6, 10)),
      mask: bytesToIp(body.subarray(10, 14)),
      gateway: bytesToIp(body.subarray(14, 18))
    }
  }
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run tests/socket/codec.test.ts
```
预期：PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/socket-service/codec.ts tests/socket/codec.test.ts
git commit -m "feat(socket-service): add placeholder packet codec"
```

---

### Task 3: udp-multicast.ts（UdpSocket 抽象 + Fake 桩 + dgram 生产，TDD）

**Files:**
- Create: `src/main/socket-service/udp-multicast.ts`
- Create: `tests/socket/udp-multicast.test.ts`

- [ ] **Step 1: 写失败测试（仅 FakeUdpSocket，不碰 dgram）**

`tests/socket/udp-multicast.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { FakeUdpSocket } from '../../src/main/socket-service/udp-multicast'

describe('FakeUdpSocket', () => {
  it('记录 send 调用的 buf/port/addr', async () => {
    const sock = new FakeUdpSocket()
    await sock.bind(0)
    sock.addMembership('239.0.0.1')
    const buf = Buffer.from([1, 2, 3])
    await sock.send(buf, 6000, '239.0.0.1')
    expect(sock.sent).toHaveLength(1)
    expect(sock.sent[0].buf).toEqual(buf)
    expect(sock.sent[0].port).toBe(6000)
    expect(sock.sent[0].addr).toBe('239.0.0.1')
  })

  it('记录 addMembership', async () => {
    const sock = new FakeUdpSocket()
    await sock.bind(0)
    sock.addMembership('239.0.0.1')
    sock.addMembership('239.0.0.2')
    expect(sock.memberships).toEqual(['239.0.0.1', '239.0.0.2'])
  })

  it('emitMessage 触发 onMessage 回调', async () => {
    const sock = new FakeUdpSocket()
    await sock.bind(0)
    const received: { buf: Buffer; address: string; port: number }[] = []
    sock.onMessage((buf, rinfo) => received.push({ buf, address: rinfo.address, port: rinfo.port }))
    const buf = Buffer.from([9, 9])
    sock.emitMessage(buf, { address: '192.168.1.50', port: 7000 })
    expect(received).toHaveLength(1)
    expect(received[0].buf).toEqual(buf)
    expect(received[0].address).toBe('192.168.1.50')
    expect(received[0].port).toBe(7000)
  })

  it('close 不抛错', async () => {
    const sock = new FakeUdpSocket()
    await sock.bind(0)
    expect(() => sock.close()).not.toThrow()
  })
})
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/socket/udp-multicast.test.ts
```
预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 udp-multicast.ts**

`src/main/socket-service/udp-multicast.ts`：

```ts
export interface UdpRinfo {
  address: string
  port: number
}

export interface UdpSocket {
  bind(port: number): Promise<void>
  addMembership(groupAddr: string, iface?: string): void
  send(buf: Buffer, port: number, addr: string): Promise<void>
  onMessage(cb: (buf: Buffer, rinfo: UdpRinfo) => void): void
  close(): void
}

/**
 * 生产实现：Node dgram。主进程必为 Node，require('dgram') 可用。
 * 真实组播回环验证推迟手动（同 NetTransport 策略）；单测用 FakeUdpSocket。
 */
export class MulticastUdpSocket implements UdpSocket {
  private readonly socket: import('dgram').Socket
  private msgCb?: (buf: Buffer, rinfo: UdpRinfo) => void

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const dgram = require('dgram')
    this.socket = dgram.createSocket('udp4')
    this.socket.on('message', (buf: Buffer, rinfo: UdpRinfo) => {
      this.msgCb?.(buf, rinfo)
    })
  }

  bind(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.once('error', reject)
      this.socket.bind(port, () => {
        this.socket.removeListener('error', reject)
        resolve()
      })
    })
  }

  addMembership(groupAddr: string, iface?: string): void {
    this.socket.addMembership(groupAddr, iface)
  }

  send(buf: Buffer, port: number, addr: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.send(buf, port, addr, (err: Error | null) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  onMessage(cb: (buf: Buffer, rinfo: UdpRinfo) => void): void {
    this.msgCb = cb
  }

  close(): void {
    this.socket.close()
  }
}

/**
 * 测试桩：记录 send/addMembership，可注入 onMessage 响应。不碰 dgram/网络。
 */
export class FakeUdpSocket implements UdpSocket {
  readonly sent: { buf: Buffer; port: number; addr: string }[] = []
  readonly memberships: string[] = []
  private msgCb?: (buf: Buffer, rinfo: UdpRinfo) => void

  async bind(_port: number): Promise<void> {}

  addMembership(groupAddr: string): void {
    this.memberships.push(groupAddr)
  }

  async send(buf: Buffer, port: number, addr: string): Promise<void> {
    this.sent.push({ buf: Buffer.from(buf), port, addr })
  }

  onMessage(cb: (buf: Buffer, rinfo: UdpRinfo) => void): void {
    this.msgCb = cb
  }

  /** 测试辅助：模拟设备回包 */
  emitMessage(buf: Buffer, rinfo: UdpRinfo): void {
    this.msgCb?.(buf, rinfo)
  }

  close(): void {}
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run tests/socket/udp-multicast.test.ts
```
预期：PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/socket-service/udp-multicast.ts tests/socket/udp-multicast.test.ts
git commit -m "feat(socket-service): add UdpSocket abstraction and fake stub"
```

---

### Task 4: ip-modify.ts（业务编排，TDD）

**Files:**
- Create: `src/main/socket-service/ip-modify.ts`
- Create: `tests/socket/ip-modify.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/socket/ip-modify.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { IpModifyService } from '../../src/main/socket-service/ip-modify'
import { FakeUdpSocket } from '../../src/main/socket-service/udp-multicast'
import { PlaceholderCodec } from '../../src/main/socket-service/codec'
import { SocketError } from '../../src/main/socket-service/errors'
import { PACKET_TYPE_MODIFY_IP } from '../../src/main/socket-service/types'

const config = { groupAddr: '239.0.0.1', groupPort: 6000, bindPort: 0 }

function makeService() {
  const sock = new FakeUdpSocket()
  const codec = new PlaceholderCodec()
  return { sock, codec, svc: new IpModifyService(sock, codec, config) }
}

describe('IpModifyService.modifyDeviceIp', () => {
  const params = { mac: '00:11:22:33:44:55', newIp: '192.168.1.100', mask: '255.255.255.0', gateway: '192.168.1.1' }

  it('编码后发送到组播地址端口', async () => {
    const { sock, codec, svc } = makeService()
    const result = await svc.modifyDeviceIp(params)
    expect(result).toEqual({ ok: true })
    expect(sock.sent).toHaveLength(1)
    expect(sock.sent[0].port).toBe(6000)
    expect(sock.sent[0].addr).toBe('239.0.0.1')
    // 发出的 buf 经 decode 还原回原参数
    const decoded = codec.decode(sock.sent[0].buf)
    expect(decoded).toEqual({ type: PACKET_TYPE_MODIFY_IP, ...params })
  })

  it('非法 mac 抛 SocketError(codec)', async () => {
    const { svc } = makeService()
    await expect(svc.modifyDeviceIp({ ...params, mac: 'bad' })).rejects.toThrow(SocketError)
  })

  it('非法 ip 抛 SocketError(codec)', async () => {
    const { svc } = makeService()
    await expect(svc.modifyDeviceIp({ ...params, newIp: '999.1.1.1' })).rejects.toThrow(SocketError)
  })

  it('send 失败抛 SocketError(send)', async () => {
    const sock = new FakeUdpSocket()
    const failingSock: typeof sock = {
      ...sock,
      send: async () => { throw new Error('EADDRNOTAVAIL') }
    }
    const svc = new IpModifyService(failingSock, new PlaceholderCodec(), config)
    try {
      await svc.modifyDeviceIp(params)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SocketError)
      expect((e as SocketError).category).toBe('send')
      expect((e as SocketError).retryable).toBe(true)
    }
  })
})
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/socket/ip-modify.test.ts
```
预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 ip-modify.ts**

`src/main/socket-service/ip-modify.ts`：

```ts
import type { UdpSocket } from './udp-multicast'
import type { PacketCodec } from './codec'
import type { IpModifyParams, IpModifyResult, MulticastConfig } from './types'
import { PACKET_TYPE_MODIFY_IP } from './types'
import { SocketError } from './errors'

export class IpModifyService {
  constructor(
    private readonly socket: UdpSocket,
    private readonly codec: PacketCodec,
    private readonly config: MulticastConfig
  ) {}

  async modifyDeviceIp(params: IpModifyParams): Promise<IpModifyResult> {
    // 参数校验（非法 mac/ip 由 codec 抛 SocketError(codec)）
    const buf = this.codec.encode({ type: PACKET_TYPE_MODIFY_IP, ...params })
    try {
      await this.socket.send(buf, this.config.groupPort, this.config.groupAddr)
    } catch (e) {
      if (e instanceof SocketError) throw e
      throw new SocketError(
        'SOCKET_SEND_FAILED',
        'send',
        `send failed: ${(e as Error).message}`,
        true
      )
    }
    return { ok: true }
  }
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run tests/socket/ip-modify.test.ts
```
预期：PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/socket-service/ip-modify.ts tests/socket/ip-modify.test.ts
git commit -m "feat(socket-service): add IpModifyService orchestration"
```

---

### Task 5: IPC 契约接入（channels + api + register + preload）

**Files:**
- Modify: `src/shared/ipc/channels.ts`
- Modify: `src/shared/ipc/api.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc/register.ts`
- Create: `tests/renderer/socket-view.test.ts`（下一 Task 一起跑，本 Task 不单独测）

- [ ] **Step 1: 扩展 channels.ts**

在 `src/shared/ipc/channels.ts` 末尾追加：

```ts
// ---- SOCKET ----
export const SOCKET_CHANNELS = {
  modifyIp: 'socket:modify-ip'
} as const

export type SocketChannelName = (typeof SOCKET_CHANNELS)[keyof typeof SOCKET_CHANNELS]

export const ipModifyParamsSchema = z.object({
  mac: z.string().min(1),
  newIp: z.string().min(1),
  mask: z.string().min(1),
  gateway: z.string().min(1)
})
```

- [ ] **Step 2: 扩展 api.ts**

在 `src/shared/ipc/api.ts` 的 `RendererApi` 前加 `SocketApi`，并把 `socket` 加入 `RendererApi`：

```ts
export interface SocketApi {
  modifyIp(params: { mac: string; newIp: string; mask: string; gateway: string }): Promise<{ ok: boolean }>
}
```

`RendererApi` 改为：

```ts
export interface RendererApi {
  ping(): Promise<{ ok: boolean }>
  getVersion(): Promise<VersionInfo>
  sdk: SdkApi
  db: DbApi
  http: HttpApi
  socket: SocketApi
  useCase: UseCaseApi
}
```

- [ ] **Step 3: 扩展 preload/index.ts**

`src/preload/index.ts` 导入加 `SOCKET_CHANNELS`，`api` 对象加：

```ts
  socket: {
    modifyIp: (params) => ipcRenderer.invoke(SOCKET_CHANNELS.modifyIp, params)
  },
```

- [ ] **Step 4: 扩展 register.ts**

`src/main/ipc/register.ts` 顶部 import 加：

```ts
import { SOCKET_CHANNELS, ipModifyParamsSchema } from '@shared/ipc/channels'
import { MulticastUdpSocket } from '../socket-service/udp-multicast'
import { PlaceholderCodec } from '../socket-service/codec'
import { IpModifyService } from '../socket-service/ip-modify'
import { SocketError, serializeSocketError } from '../socket-service/errors'
```

在 `ensureHttpClient` 之后、`registerIpc` 之前加单例：

```ts
let ipModifyService: IpModifyService | null = null

function ensureIpModifyService(): IpModifyService {
  if (!ipModifyService) {
    // 配置默认值占位（规范/设备文档确认后更新；将来从 db socket_config 读取）
    const config = { groupAddr: '239.0.0.1', groupPort: 6000, bindPort: 0 }
    ipModifyService = new IpModifyService(new MulticastUdpSocket(), new PlaceholderCodec(), config)
  }
  return ipModifyService
}
```

在 `registerIpc` 内、`wrapUseCase` 之后加 handler：

```ts
  const wrapSocket = async <T>(fn: () => Promise<T> | T): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof SocketError) throw serializeSocketError(e)
      throw e
    }
  }

  ipcMain.handle(SOCKET_CHANNELS.modifyIp, (_e, params) =>
    wrapSocket(async () => {
      const s = ensureIpModifyService()
      return s.modifyDeviceIp(validate(ipModifyParamsSchema, params))
    })
  )
```

- [ ] **Step 5: 运行类型检查**

```bash
npm run typecheck
```
预期：PASS（IPC 契约三端一致）。

- [ ] **Step 6: 提交**

```bash
git add src/shared/ipc/channels.ts src/shared/ipc/api.ts src/preload/index.ts src/main/ipc/register.ts
git commit -m "feat(socket-service): wire IPC channels for modifyIp"
```

---

### Task 6: renderer 验证页（SocketView + router + HomeView）

**Files:**
- Create: `src/renderer/src/views/SocketView.vue`
- Modify: `src/renderer/src/router.ts`
- Modify: `src/renderer/src/views/HomeView.vue`
- Create: `tests/renderer/socket-view.test.ts`

- [ ] **Step 1: 写失败测试**

`tests/renderer/socket-view.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import SocketView from '../../src/renderer/src/views/SocketView.vue'
import type { RendererApi } from '../../src/shared/ipc/api'

beforeEach(() => {
  window.api = {
    ping: vi.fn(),
    getVersion: vi.fn(),
    sdk: { discover: vi.fn().mockResolvedValue([]) },
    db: { getAppConfig: vi.fn(), setAppConfig: vi.fn(), deleteAppConfig: vi.fn(), listAppConfig: vi.fn().mockResolvedValue([]), getSecretConfig: vi.fn(), setSecretConfig: vi.fn(), deleteSecretConfig: vi.fn(), listSecretConfig: vi.fn().mockResolvedValue([]) },
    http: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), setToken: vi.fn(), setRefreshToken: vi.fn(), clearTokens: vi.fn() },
    socket: { modifyIp: vi.fn().mockResolvedValue({ ok: true }) },
    useCase: { configLoadAuth: vi.fn().mockResolvedValue({ sdkSession: { id: 1 } }) }
  } as unknown as RendererApi
})

describe('SocketView', () => {
  it('填表点按钮触发 modifyIp 并显示已发送', async () => {
    const wrapper = mount(SocketView, { global: { stubs: { RouterLink: true } } })
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('00:11:22:33:44:55')
    await inputs[1].setValue('192.168.1.100')
    await inputs[2].setValue('255.255.255.0')
    await inputs[3].setValue('192.168.1.1')
    await wrapper.find('button').trigger('click')
    await new Promise((r) => setTimeout(r, 10))
    expect(window.api.socket.modifyIp).toHaveBeenCalledWith({
      mac: '00:11:22:33:44:55', newIp: '192.168.1.100', mask: '255.255.255.0', gateway: '192.168.1.1'
    })
    expect(wrapper.text()).toContain('已发送')
  })
})
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/renderer/socket-view.test.ts
```
预期：FAIL，组件不存在。

- [ ] **Step 3: 实现 SocketView.vue**

`src/renderer/src/views/SocketView.vue`：

```vue
<template>
  <div class="socket-view">
    <h2>Socket POC（裸报文修改 IP）</h2>
    <p>通过 UDP 组播裸报文向设备发送修改 IP 指令（不经 SDK）。</p>
    <form @submit.prevent="onSubmit">
      <label>MAC <input v-model="mac" placeholder="00:11:22:33:44:55" /></label>
      <label>新 IP <input v-model="newIp" placeholder="192.168.1.100" /></label>
      <label>掩码 <input v-model="mask" placeholder="255.255.255.0" /></label>
      <label>网关 <input v-model="gateway" placeholder="192.168.1.1" /></label>
      <button type="submit" :disabled="loading">{{ loading ? '发送中...' : '发送修改 IP 指令' }}</button>
    </form>
    <p v-if="result">已发送</p>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const mac = ref('')
const newIp = ref('')
const mask = ref('')
const gateway = ref('')
const loading = ref(false)
const result = ref<{ ok: boolean } | null>(null)
const error = ref('')

async function onSubmit(): Promise<void> {
  loading.value = true
  error.value = ''
  result.value = null
  try {
    result.value = await window.api.socket.modifyIp({
      mac: mac.value,
      newIp: newIp.value,
      mask: mask.value,
      gateway: gateway.value
    })
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}
</script>
```

- [ ] **Step 4: 扩展 router.ts**

在 `src/renderer/src/router.ts` 的 routes 数组加（参照现有 `/sdk`、`/http` 条目格式）：

```ts
  { path: '/socket', name: 'socket', component: () => import('./views/SocketView.vue') }
```

- [ ] **Step 5: 扩展 HomeView.vue**

在 `src/renderer/src/views/HomeView.vue` 的 POC 入口链接区加（参照现有 Sdk/Http 链接）：

```vue
  <RouterLink to="/socket">Socket POC</RouterLink>
```

- [ ] **Step 6: 运行确认通过**

```bash
npx vitest run tests/renderer/socket-view.test.ts
```
预期：PASS。

- [ ] **Step 7: 提交**

```bash
git add src/renderer/src/views/SocketView.vue src/renderer/src/router.ts src/renderer/src/views/HomeView.vue tests/renderer/socket-view.test.ts
git commit -m "feat(socket-service): add SocketView and router entry"
```

---

### Task 7: 全量验证 + 文档更新

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture-diagrams.md`

- [ ] **Step 1: 全量测试**

```bash
npm run typecheck
npm test
npm run build
```
预期：typecheck PASS、全量测试 PASS（含 `tests/socket/**` + `tests/renderer/socket-view.test.ts`）、build 成功。

- [ ] **Step 2: 更新 README 目录结构**

在 `README.md` 的目录树 `src/main/` 下、`http-client/` 之后加 `socket-service/` 块（参照 http-client 注释格式）：

```
│   │   ├── socket-service/             # 裸报文 UDP 组播（修改 IP，不经 SDK）
│   │   │   ├── udp-multicast.ts        # UdpSocket 接口 + MulticastUdpSocket(dgram) + FakeUdpSocket(桩)
│   │   │   ├── codec.ts                # PacketCodec 接口 + 占位实现（规范到替换）
│   │   │   ├── ip-modify.ts            # IpModifyService（校验+encode+send）
│   │   │   ├── errors.ts               # SocketError + 序列化
│   │   │   └── types.ts                # IpModifyParams/MulticastConfig
```

并在 `tests/` 树加 `socket/`（裸报文单测，FakeUdpSocket 驱动）。

- [ ] **Step 3: 更新 architecture-diagrams.md**

在 `docs/architecture-diagrams.md` 加 socket-service 的逻辑视图（Mermaid）：进程模型里 socket-service 在主进程；类图含 `IpModifyService` → `UdpSocket` + `PacketCodec`；时序图 Renderer→Preload→Main::socket-service→UdpSocket→设备。说明与 SDK discover 串联（discover 拿 mac → modifyIp 改 IP）。

- [ ] **Step 4: 提交**

```bash
git add README.md docs/architecture-diagrams.md
git commit -m "docs: add socket-service to README and architecture diagrams"
```

---

## 待规范项（规范到后处理）

- 组播地址/端口默认值（`239.0.0.1:6000`）→ 更新 `register.ts` 的 `config` 默认值，或从 db `socket_config` 读取。
- 报文字段布局（magic/ver/type/length/body/crc32）→ 只改 `codec.ts` 内部，接口不变。
- 是否需要设备应答 → 启用 `UdpSocket.onMessage` + `IpModifyService` 等待逻辑（接口已预留）。
