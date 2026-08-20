import type { Socket } from 'dgram'

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
  private readonly socket: Socket
  private msgCb?: (buf: Buffer, rinfo: UdpRinfo) => void

  constructor() {
    const dgram = require('dgram')
    this.socket = dgram.createSocket('udp4') as Socket
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
