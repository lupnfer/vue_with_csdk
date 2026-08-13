import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { WorkerTransport } from '../../src/main/sdk-service/transport/worker-transport'

const workerScript = join(process.cwd(), 'out/main/workers/sdk.worker.js')

describe('sdk-service 生命周期', () => {
  let transport: WorkerTransport

  afterEach(() => {
    transport?.terminate()
  })

  it('version 调用返回版本号', async () => {
    transport = new WorkerTransport(workerScript)
    const v = await transport.invoke<string>('version', [])
    expect(v).toBe('crc-mock-1.0.0')
  })

  it('init → open → release → close 全程成功', async () => {
    transport = new WorkerTransport(workerScript)
    const session = await transport.invoke<{ id: number }>('init', [{ mode: 1, logger: { level: 2, prefix: 't' } }])
    expect(session.id).toBeGreaterThan(0)
    const handle = await transport.invoke<{ id: number }>('open', [session.id])
    expect(handle.id).toBeGreaterThan(0)
    await transport.invoke('release', [handle.id])
    await transport.invoke('close', [session.id])
  })

  it('重复 release 返回已释放错误', async () => {
    transport = new WorkerTransport(workerScript)
    const session = await transport.invoke<{ id: number }>('init', [{ mode: 1, logger: { level: 0, prefix: '' } }])
    const handle = await transport.invoke<{ id: number }>('open', [session.id])
    await transport.invoke('release', [handle.id])
    // worker 在 release 后从 handles 表删除句柄，再次 release 命中"句柄不存在"分支，
    // 返回结构化 code=SDK_ALREADY_RELEASED（message 仅是 'handle not found' 细节，
    // 不含 code 字符串），故断言应针对结构化 code 而非 message 文本。
    await expect(transport.invoke('release', [handle.id])).rejects.toMatchObject({ code: 'SDK_ALREADY_RELEASED' })
    await transport.invoke('close', [session.id])
  })
})
