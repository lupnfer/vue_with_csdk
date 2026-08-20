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
      throw new SocketError('SOCKET_SEND_FAILED', 'send', `send failed: ${(e as Error).message}`, true)
    }
    return { ok: true }
  }
}
