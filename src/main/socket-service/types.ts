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
