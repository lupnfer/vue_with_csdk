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
