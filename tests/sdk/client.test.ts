import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { WorkerTransport } from '../../src/main/sdk-service/transport/worker-transport'
import { SdkClient } from '../../src/main/sdk-service/sdk-client'
import type { SdkEvent } from '../../src/main/sdk-service/types'

const workerScript = join(process.cwd(), 'out/main/workers/sdk.worker.js')

describe('SdkClient', () => {
  let client: SdkClient

  afterEach(() => {
    client?.terminate()
  })

  it('端到端：init → open → startScan → 收到事件 → dispose', async () => {
    const transport = new WorkerTransport(workerScript)
    client = new SdkClient(transport)

    const session = await client.init({ mode: 1, logger: { level: 0, prefix: '' } })
    const handle = await client.open(session)

    const events: SdkEvent[] = []
    client.on('event', (e) => events.push(e))

    await client.startScan(handle)
    const deadline = Date.now() + 3000
    while (events.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(events.length).toBeGreaterThanOrEqual(2)

    await client.dispose(handle)
    await client.disposeSession(session)
  })
})
