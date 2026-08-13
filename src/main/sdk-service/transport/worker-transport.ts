import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { InvokeMessage, WorkerOutbound } from './types'
import { deserializeError, type SerializedError } from '../errors'

export interface Transport {
  invoke<T>(method: string, args: unknown[]): Promise<T>
  on(event: 'data', cb: (payload: unknown) => void): void
  on(event: 'error', cb: (err: unknown) => void): void
  terminate(): void
}

export class WorkerTransport implements Transport {
  private readonly worker: Worker
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  private readonly emitter = new EventEmitter()
  private callId = 1

  constructor(workerScriptPath?: string) {
    const script = workerScriptPath ?? join(__dirname, 'workers/sdk.worker.js')
    this.worker = new Worker(script)
    this.worker.on('message', (msg: WorkerOutbound) => this.handleMessage(msg))
    this.worker.on('error', (err) => this.emitter.emit('error', err))
  }

  private handleMessage(msg: WorkerOutbound): void {
    if (msg.type === 'event') {
      this.emitter.emit('data', msg.data)
      return
    }
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.ok) {
      p.resolve(msg.data)
    } else {
      p.reject(deserializeError(msg.error as SerializedError))
    }
  }

  invoke<T>(method: string, args: unknown[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.callId++
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      const invoke: InvokeMessage = { type: 'invoke', id, method, args }
      this.worker.postMessage(invoke)
    })
  }

  on(event: 'data' | 'error', cb: (payload: unknown) => void): void {
    this.emitter.on(event, cb)
  }

  terminate(): void {
    this.worker.terminate()
  }
}
