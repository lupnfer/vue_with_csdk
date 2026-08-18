import type { Transport } from './transport/worker-transport'
import type { DiscoveredDevice } from './types'

export class SdkClient {
  constructor(private readonly transport: Transport) {}

  async discover(): Promise<DiscoveredDevice[]> {
    return this.transport.invoke<DiscoveredDevice[]>('discover', [])
  }

  terminate(): void {
    this.transport.terminate()
  }
}
