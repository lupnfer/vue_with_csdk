import { describe, it, expect } from 'vitest'
import { ConfigLoadAuthUseCase } from '../../src/main/use-cases/config-load-auth'
import { UseCaseError } from '../../src/main/use-cases/errors'
import { makeServices, FakeHttpClient, InMemoryDbClient } from './stubs'

describe('ConfigLoadAuthUseCase', () => {
  it('成功路径：db 预置配置 → http.setToken → sdk.init → 返回 session', async () => {
    const services = makeServices({
      db: {
        appConfig: {
          http_config: JSON.stringify({ baseUrl: 'http://api', refreshUrl: 'http://api/refresh' }),
          sdk_config: JSON.stringify({ mode: 1, logger: { level: 0, prefix: '' } })
        },
        secretConfig: { http_token: 'tok', http_refresh_token: 'ref' }
      }
    })
    const uc = new ConfigLoadAuthUseCase(services)

    const result = await uc.execute()

    expect(result.sdkSession).toBeDefined()
    expect(result.sdkSession?.id).toBe(1)
    // http.setToken 被调
    expect(await services.http.tokens.getToken()).toBe('tok')
  })

  it('db 读配置失败抛 UseCaseError(category=db)', async () => {
    const services = makeServices({ db: { failOn: 'getAppConfig' } })
    const uc = new ConfigLoadAuthUseCase(services)

    await expect(uc.execute()).rejects.toMatchObject({ category: 'db' })
  })

  it('http.setToken 失败抛 UseCaseError(category=http)', async () => {
    const services = makeServices({
      db: { secretConfig: { http_token: 'tok', http_refresh_token: 'ref' } },
      http: { failSetToken: true }
    })
    const uc = new ConfigLoadAuthUseCase(services)

    await expect(uc.execute()).rejects.toMatchObject({ category: 'http' })
  })

  it('配置缺失：db 没预置 token → http.setToken 跳过 → 继续 sdk.init', async () => {
    const services = makeServices({
      db: { appConfig: { sdk_config: JSON.stringify({ mode: 1, logger: { level: 0, prefix: '' } }) } }
    })
    const uc = new ConfigLoadAuthUseCase(services)

    const result = await uc.execute()

    expect(result.sdkSession).toBeDefined()
    // token 没被设置
    expect(await services.http.tokens.getToken()).toBeNull()
  })
})
