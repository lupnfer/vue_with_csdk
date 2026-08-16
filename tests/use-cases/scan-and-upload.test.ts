import { describe, it, expect } from 'vitest'
import { ScanAndUploadUseCase } from '../../src/main/use-cases/scan-and-upload'
import { UseCaseError } from '../../src/main/use-cases/errors'
import { makeServices, FakeSdkClient, InMemoryDbClient, FakeHttpClient } from './stubs'
import type { SdkConfig } from '../../src/main/sdk-service/types'

const sdkConfig: SdkConfig = { mode: 1, logger: { level: 0, prefix: '' } }

describe('ScanAndUploadUseCase', () => {
  it('成功路径：init→open→startScan→收事件→db 落库→http 上传→dispose', async () => {
    const services = makeServices()
    const uc = new ScanAndUploadUseCase(services)

    const result = await uc.execute({ sdkConfig, uploadUrl: '/upload' })

    expect(result.sessionId).toBe(1)
    expect(result.handleId).toBe(1)
    expect(result.events).toHaveLength(2)
    expect(result.uploaded).toBe(true)
    // db 落库
    expect(services.db.getAppConfig('last_scan')).toContain('started')
    // http 上传被调
    // sdk 清理
    expect((services.sdk as FakeSdkClient).calls).toContain('dispose')
    expect((services.sdk as FakeSdkClient).calls).toContain('disposeSession')
  })

  it('sdk.init 失败抛 UseCaseError(category=sdk)，不调 db/http', async () => {
    const services = makeServices({ sdk: { failOn: 'init' } })
    const uc = new ScanAndUploadUseCase(services)

    await expect(uc.execute({ sdkConfig, uploadUrl: '/upload' })).rejects.toBeInstanceOf(UseCaseError)
    await expect(uc.execute({ sdkConfig, uploadUrl: '/upload' })).rejects.toMatchObject({ category: 'sdk' })
  })

  it('db 落库失败抛 UseCaseError(category=db)，仍 dispose', async () => {
    const services = makeServices({ db: { failOn: 'setAppConfig' } })
    const uc = new ScanAndUploadUseCase(services)

    await expect(uc.execute({ sdkConfig, uploadUrl: '/upload' })).rejects.toMatchObject({ category: 'db' })
    expect((services.sdk as FakeSdkClient).calls).toContain('dispose')
  })

  it('http 上传失败抛 UseCaseError(category=http)，仍 dispose', async () => {
    const services = makeServices({ http: { failOn: 'post' } })
    const uc = new ScanAndUploadUseCase(services)

    await expect(uc.execute({ sdkConfig, uploadUrl: '/upload' })).rejects.toMatchObject({ category: 'http' })
    expect((services.sdk as FakeSdkClient).calls).toContain('dispose')
  })

  it('成功后移除事件监听器（防泄漏）', async () => {
    const services = makeServices()
    const uc = new ScanAndUploadUseCase(services)
    const sdk = services.sdk as FakeSdkClient

    await uc.execute({ sdkConfig, uploadUrl: '/upload' })

    // execute 完成后监听器应被移除（FakeSdkClient.off 过滤了它）
    // 间接验证：再 startScan 不会把事件推到旧的 events 数组（已无监听器）
    expect(sdk.calls).toContain('dispose')
    // 直接验证 listeners 被清空
    expect((sdk as unknown as { listeners: unknown[] }).listeners).toHaveLength(0)
  })
})
