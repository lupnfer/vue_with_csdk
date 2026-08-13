import type { SerializedError } from '../errors'

/** 主进程 → worker */
export interface InvokeMessage {
  type: 'invoke'
  id: number
  method: string
  args: unknown[]
}

/** worker → 主进程：调用结果 */
export type ResultMessage =
  | { type: 'result'; id: number; ok: true; data: unknown }
  | { type: 'result'; id: number; ok: false; error: SerializedError }

/** worker → 主进程：异步事件 */
export interface EventMessage {
  type: 'event'
  data: unknown
}

export type WorkerInbound = InvokeMessage
export type WorkerOutbound = ResultMessage | EventMessage
