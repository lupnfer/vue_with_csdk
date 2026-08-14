export interface TokenStore {
  getToken(): Promise<string | null>
  setToken(token: string): Promise<void>
  getRefreshToken(): Promise<string | null>
  setRefreshToken(token: string): Promise<void>
  clear(): Promise<void>
}

/** 测试桩：内存存储，不碰 db/Electron。 */
export class InMemoryTokenStore implements TokenStore {
  private token: string | null = null
  private refresh: string | null = null

  async getToken(): Promise<string | null> {
    return this.token
  }
  async setToken(token: string): Promise<void> {
    this.token = token
  }
  async getRefreshToken(): Promise<string | null> {
    return this.refresh
  }
  async setRefreshToken(token: string): Promise<void> {
    this.refresh = token
  }
  async clear(): Promise<void> {
    this.token = null
    this.refresh = null
  }
}

/**
 * 生产实现：token + refreshToken 存 db-service 的 secret_config（字段加密）。
 * 构造时注入 DbClient（避免本模块直接依赖 db-client，靠接口耦合）。
 */
export interface SecretStore {
  getSecret(key: string): Promise<string | null>
  setSecret(key: string, value: string): Promise<void>
}

export class DbTokenStore implements TokenStore {
  private static readonly TOKEN_KEY = 'http_token'
  private static readonly REFRESH_KEY = 'http_refresh_token'

  constructor(private readonly secrets: SecretStore) {}

  async getToken(): Promise<string | null> {
    return this.secrets.getSecret(DbTokenStore.TOKEN_KEY)
  }
  async setToken(token: string): Promise<void> {
    await this.secrets.setSecret(DbTokenStore.TOKEN_KEY, token)
  }
  async getRefreshToken(): Promise<string | null> {
    return this.secrets.getSecret(DbTokenStore.REFRESH_KEY)
  }
  async setRefreshToken(token: string): Promise<void> {
    await this.secrets.setSecret(DbTokenStore.REFRESH_KEY, token)
  }
  async clear(): Promise<void> {
    await this.secrets.setSecret(DbTokenStore.TOKEN_KEY, '')
    await this.secrets.setSecret(DbTokenStore.REFRESH_KEY, '')
  }
}
