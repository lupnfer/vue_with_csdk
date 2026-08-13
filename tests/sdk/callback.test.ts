import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { WorkerTransport } from '../../src/main/sdk-service/transport/worker-transport'
import type { SdkEvent } from '../../src/main/sdk-service/types'

const workerScript = join(process.cwd(), 'out/main/workers/sdk.worker.js')

describe('sdk-service 异步回调线程编组', () => {
  let transport: WorkerTransport

  afterEach(() => {
    transport?.terminate()
  })

  it('startScan 后在超时内收到回调事件，数据正确', async () => {
    transport = new WorkerTransport(workerScript)
    const session = await transport.invoke<{ id: number }>('init', [{ mode: 1, logger: { level: 0, prefix: '' } }])
    const handle = await transport.invoke<{ id: number }>('open', [session.id])

    const events: SdkEvent[] = []
    transport.on('data', (d) => events.push(d as SdkEvent))

    await transport.invoke('start', [handle.id])

    // 等待两个回调事件（mock 投递 started + done）
    const deadline = Date.now() + 3000
    while (events.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(events.length).toBeGreaterThanOrEqual(2)
    expect(events[0].eventType).toBe(1)
    expect(events[0].payload).toContain('started')
    expect(events[1].eventType).toBe(2)
    expect(events[1].payload).toContain('done')
    expect(events.every((e) => e.handleId === handle.id)).toBe(true)

    await transport.invoke('release', [handle.id])
    await transport.invoke('close', [session.id])
  })

  it('startScan 立即返回，不阻塞 worker（回调到达后 worker 仍可响应 invoke）', async () => {
    transport = new WorkerTransport(workerScript)
    const session = await transport.invoke<{ id: number }>('init', [{ mode: 1, logger: { level: 0, prefix: '' } }])
    const handle = await transport.invoke<{ id: number }>('open', [session.id])
    transport.on('data', () => {})

    const startAt = Date.now()
    await transport.invoke('start', [handle.id])
    const startDur = Date.now() - startAt
    // start 应几乎立即返回（< 100ms），证明不阻塞
    expect(startDur).toBeLessThan(100)

    // 回调排队期间 worker 仍响应 version
    const v = await transport.invoke<string>('version', [])
    expect(v).toBe('crc-mock-1.0.0')

    // 等回调排空再释放，避免 detached 线程访问已释放句柄
    await new Promise((r) => setTimeout(r, 200))
    await transport.invoke('release', [handle.id])
    await transport.invoke('close', [session.id])
  })
})
