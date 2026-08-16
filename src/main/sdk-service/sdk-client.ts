import { EventEmitter } from 'node:events'
import type { Transport } from './transport/worker-transport'
import type { Session, Handle, SdkConfig, SdkEvent } from './types'
import type { ISdkClient } from '../use-cases/services'

export class SdkClient implements ISdkClient {
  private readonly transport: Transport
  private readonly emitter = new EventEmitter()

  constructor(transport: Transport) {
    this.transport = transport
    this.transport.on('data', (data) => {
      this.emitter.emit('event', data)
    })
  }

  init(config: SdkConfig): Promise<Session> {
    return this.transport.invoke<Session>('init', [config])
  }

  open(session: Session): Promise<Handle> {
    return this.transport.invoke<Handle>('open', [session.id])
  }

  startScan(handle: Handle): Promise<void> {
    return this.transport.invoke<void>('start', [handle.id])
  }

  dispose(handle: Handle): Promise<void> {
    return this.transport.invoke<void>('release', [handle.id])
  }

  disposeSession(session: Session): Promise<void> {
    return this.transport.invoke<void>('close', [session.id])
  }

  on(event: 'event', cb: (e: SdkEvent) => void): void {
    this.emitter.on(event, cb)
  }

  terminate(): void {
    this.transport.terminate()
  }
}
