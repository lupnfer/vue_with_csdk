export interface HttpConfig {
  baseUrl: string
  refreshUrl: string
  timeoutMs: number
  maxRetries: number
}

export function defaultHttpConfig(): HttpConfig {
  return { baseUrl: '', refreshUrl: '', timeoutMs: 10000, maxRetries: 3 }
}

/** 从部分配置或 JSON 字符串合并出完整 HttpConfig（缺失项用默认）。 */
export function mergeConfig(input: Partial<HttpConfig> | string): HttpConfig {
  const def = defaultHttpConfig()
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input) as Partial<HttpConfig>
      return { ...def, ...parsed }
    } catch {
      return def
    }
  }
  return { ...def, ...input }
}

/** 生产用：从 db-service 的 app_config 读写 HttpConfig。 */
export interface AppConfigStore {
  getAppConfig(key: string): Promise<string | null>
  setAppConfig(key: string, value: string): Promise<void>
}

export class DbHttpConfig {
  private static readonly CONFIG_KEY = 'http_config'
  private cached: HttpConfig | null = null

  constructor(private readonly store: AppConfigStore) {}

  async load(): Promise<HttpConfig> {
    if (this.cached) return this.cached
    const raw = await this.store.getAppConfig(DbHttpConfig.CONFIG_KEY)
    this.cached = mergeConfig(raw ?? defaultHttpConfig())
    return this.cached
  }

  async set(config: Partial<HttpConfig>): Promise<void> {
    const current = await this.load()
    this.cached = { ...current, ...config }
    await this.store.setAppConfig(DbHttpConfig.CONFIG_KEY, JSON.stringify(this.cached))
  }
}
