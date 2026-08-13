import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { WorkerTransport } from '../../src/main/sdk-service/transport/worker-transport'

const workerScript = join(process.cwd(), 'out/main/workers/sdk.worker.js')

describe('sdk-service 内存泄漏检测', () => {
  let transport: WorkerTransport

  afterEach(() => {
    transport?.terminate()
  })

  it('全部释放后 closeAll 报告零泄漏', async () => {
    transport = new WorkerTransport(workerScript)
    const session = await transport.invoke<{ id: number }>('init', [{ mode: 1, logger: { level: 0, prefix: '' } }])
    const handle = await transport.invoke<{ id: number }>('open', [session.id])
    await transport.invoke('release', [handle.id])
    await transport.invoke('close', [session.id])

    const report = await transport.invoke<{ handles: number; sessions: number }>('closeAll', [])
    expect(report.handles).toBe(0)
    expect(report.sessions).toBe(0)
  })

  it('故意不释放时 closeAll 报告泄漏并投递 leak 事件', async () => {
    transport = new WorkerTransport(workerScript)
    const session = await transport.invoke<{ id: number }>('init', [{ mode: 1, logger: { level: 0, prefix: '' } }])
    await transport.invoke<{ id: number }>('open', [session.id])

    const events: unknown[] = []
    transport.on('data', (d) => events.push(d))

    const report = await transport.invoke<{ handles: number; sessions: number }>('closeAll', [])
    expect(report.handles).toBeGreaterThanOrEqual(1)
    expect(report.sessions).toBeGreaterThanOrEqual(1)
    expect(events.some((e) => (e as { kind: string }).kind === 'leak')).toBe(true)
  })
})
