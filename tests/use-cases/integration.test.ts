import { describe, it, expect } from 'vitest'
import { ConfigLoadAuthUseCase } from '../../src/main/use-cases/config-load-auth'
import { ScanAndUploadUseCase } from '../../src/main/use-cases/scan-and-upload'
import { makeServices } from './stubs'

describe('use-cases 端到端', () => {
  it('ConfigLoadAuth 成功 → ScanAndUpload 成功', async () => {
    const services = makeServices({
      db: {
        appConfig: {
          sdk_config: JSON.stringify({ mode: 1, logger: { level: 0, prefix: '' } })
        },
        secretConfig: { http_token: 'tok', http_refresh_token: 'ref' }
      }
    })

    // 1. 启动初始化
    const bootstrap = await new ConfigLoadAuthUseCase(services).execute()
    expect(bootstrap.sdkSession).toBeDefined()

    // 2. 扫描并上传（复用同一 services，sdk 已 init 过——桩允许重复 init）
    const result = await new ScanAndUploadUseCase(services).execute({
      sdkConfig: { mode: 1, logger: { level: 0, prefix: '' } },
      uploadUrl: '/upload'
    })
    expect(result.uploaded).toBe(true)
    expect(result.events).toHaveLength(2)
  })
})
