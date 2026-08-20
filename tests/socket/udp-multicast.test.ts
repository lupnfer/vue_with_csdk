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
