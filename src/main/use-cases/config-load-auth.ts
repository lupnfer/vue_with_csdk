import type { Services } from './services'
import type { AppBootstrap } from './types'
import type { SdkConfig } from '../sdk-service/types'
import { wrapServiceError } from './errors'

export class ConfigLoadAuthUseCase {
  constructor(private readonly services: Services) {}

  async execute(): Promise<AppBootstrap> {
    const { sdk, db, http } = this.services

    // 1. db 读 http 配置
    let httpConfigRaw: string | null
    try {
      httpConfigRaw = db.getAppConfig('http_config')
    } catch (e) {
      throw wrapServiceError(e, 'db')
    }
    // （httpConfigRaw 供将来注入 HttpClient，POC 仅读取验证编排，不实际用）

    // 2. db 读 token
    let token: string | null
    let refreshToken: string | null
    try {
      token = db.getSecretConfig('http_token')
      refreshToken = db.getSecretConfig('http_refresh_token')
    } catch (e) {
      throw wrapServiceError(e, 'db')
    }

    // 3. 若 token 存在 → http.setToken
    if (token) {
      try {
        await http.tokens.setToken(token)
        if (refreshToken) await http.tokens.setRefreshToken(refreshToken)
      } catch (e) {
        throw wrapServiceError(e, 'http')
      }
    }

    // 4. db 读 sdk 配置
    let sdkConfigRaw: string | null
    try {
      sdkConfigRaw = db.getAppConfig('sdk_config')
    } catch (e) {
      throw wrapServiceError(e, 'db')
    }

    // 5. 若 sdk 配置存在 → sdk.init
    if (sdkConfigRaw) {
      let sdkConfig: SdkConfig
      try {
        sdkConfig = JSON.parse(sdkConfigRaw) as SdkConfig
      } catch {
        throw wrapServiceError(new Error('invalid sdk_config JSON'), 'orchestration')
      }
      try {
        const session = await sdk.init(sdkConfig)
        return { sdkSession: session }
      } catch (e) {
        throw wrapServiceError(e, 'sdk')
      }
    }

    return {}
  }
}
