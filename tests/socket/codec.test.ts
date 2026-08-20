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
    expect(buf.length).toBe(4 + 1 + 1 + 2 + 18 + 4)
  })

  it('坏 magic 抛 SocketError(codec)', () => {
    const buf = codec.encode(packet)
    const bad = Buffer.from(buf)
    bad[0] = 0x00
    expect(() => codec.decode(bad)).toThrow(SocketError)
    try {
      codec.decode(bad)
    } catch (e) {
      expect((e as SocketError).category).toBe('codec')
    }
  })

  it('坏 crc 抛 SocketError(codec)', () => {
    const buf = codec.encode(packet)
    const bad = Buffer.from(buf)
    bad[bad.length - 1] ^= 0xff
    expect(() => codec.decode(bad)).toThrow(SocketError)
    try {
      codec.decode(bad)
    } catch (e) {
      expect((e as SocketError).category).toBe('codec')
    }
  })

  it('length 不匹配抛 SocketError(codec)', () => {
    const buf = codec.encode(packet)
    const bad = Buffer.from(buf)
    bad.writeUInt16BE(99, 6)
    expect(() => codec.decode(bad)).toThrow(SocketError)
  })
})
