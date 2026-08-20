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
    const failingSock = {
      ...sock,
      send: async () => {
        throw new Error('EADDRNOTAVAIL')
      }
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
