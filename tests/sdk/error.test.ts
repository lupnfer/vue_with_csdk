import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { WorkerTransport } from '../../src/main/sdk-service/transport/worker-transport'
import { SdkError } from '../../src/main/sdk-service/errors'

const workerScript = join(process.cwd(), 'out/main/workers/sdk.worker.js')

describe('sdk-service 错误传播', () => {
  let transport: WorkerTransport

  afterEach(() => {
    transport?.terminate()
  })

  it('init 非法 config 还原为 SdkError(category=init)', async () => {
    transport = new WorkerTransport(workerScript)
    await expect(transport.invoke('init', [{ mode: -1, logger: { level: 0, prefix: '' } }])).rejects.toMatchObject({
      code: 'SDK_INIT_FAILED',
      category: 'init'
    })
  })

  it('open 不存在的 session 还原为 SdkError', async () => {
    transport = new WorkerTransport(workerScript)
    await expect(transport.invoke('open', [9999])).rejects.toBeInstanceOf(SdkError)
  })
})
