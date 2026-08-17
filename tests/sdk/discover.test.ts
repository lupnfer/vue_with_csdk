import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { WorkerTransport } from '../../src/main/sdk-service/transport/worker-transport'

const workerScript = join(process.cwd(), 'out/main/workers/sdk.worker.js')

describe('sdk discover（mock 模式）', () => {
  let transport: WorkerTransport

  afterEach(() => {
    transport?.terminate()
  })

  it('discover 返回 mock 设备列表', async () => {
    transport = new WorkerTransport(workerScript)
    const devices = await transport.invoke<{
      mac: string
      ip: string
      type: string
    }[]>('discover', [])
    expect(devices.length).toBeGreaterThanOrEqual(1)
    expect(devices[0].ip).toBe('192.168.1.100')
    expect(devices[0].type).toContain('MOCK')
  })
})
