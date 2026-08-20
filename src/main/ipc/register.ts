import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import { CHANNELS, pingResultSchema, versionResultSchema, SDK_CHANNELS, DB_CHANNELS, dbKeySchema, dbValueSchema, HTTP_CHANNELS, httpPathSchema, httpOptionsSchema, httpConfigSchema } from '@shared/ipc/channels'
import { validate } from '@shared/ipc/validate'
import { WorkerTransport } from '../sdk-service/transport/worker-transport'
import { SdkClient } from '../sdk-service/sdk-client'
import { DbClient } from '../db-service/db-client'
import { SafeStorageKeyProvider } from '../db-service/key-provider'
import { DbError, serializeDbError } from '../db-service/errors'
import { HttpClient } from '../http-client/http-client'
import { NetTransport } from '../http-client/transport'
import { DbTokenStore } from '../http-client/token-store'
import { DbHttpConfig } from '../http-client/config'
import { HttpError, serializeHttpError } from '../http-client/http-error'
import { USE_CASE_CHANNELS, SOCKET_CHANNELS, ipModifyParamsSchema } from '@shared/ipc/channels'
import { ConfigLoadAuthUseCase } from '../use-cases/config-load-auth'
import { UseCaseError, serializeUseCaseError } from '../use-cases/errors'
import { MulticastUdpSocket } from '../socket-service/udp-multicast'
import { PlaceholderCodec } from '../socket-service/codec'
import { IpModifyService } from '../socket-service/ip-modify'
import { SocketError, serializeSocketError } from '../socket-service/errors'

let client: SdkClient | null = null

function ensureClient(): SdkClient {
  if (!client) {
    client = new SdkClient(new WorkerTransport())
  }
  return client
}

let dbClient: DbClient | null = null
let dbClientPromise: Promise<DbClient> | null = null

export function getDbClient(): DbClient | null {
  return dbClient
}

function ensureDbClient(): Promise<DbClient> {
  if (!dbClientPromise) {
    dbClientPromise = (async () => {
      const userData = app.getPath('userData')
      const c = new DbClient(join(userData, 'client.db'), new SafeStorageKeyProvider(join(userData, 'db-keys.bin')))
      await c.open()
      dbClient = c
      return c
    })()
  }
  return dbClientPromise
}

let httpClient: HttpClient | null = null
let httpClientPromise: Promise<HttpClient> | null = null

function ensureHttpClient(): Promise<HttpClient> {
  if (!httpClientPromise) {
    httpClientPromise = (async () => {
      const db = await ensureDbClient()
      const configStore = new DbHttpConfig({
        getAppConfig: async (key) => db.getAppConfig(key),
        setAppConfig: async (key, value) => db.setAppConfig(key, value)
      })
      const tokenStore = new DbTokenStore({
        getSecret: async (key) => db.getSecretConfig(key),
        setSecret: async (key, value) => db.setSecretConfig(key, value)
      })
      const config = await configStore.load()
      const c = new HttpClient(new NetTransport(), tokenStore, config)
      httpClient = c
      return c
    })()
  }
  return httpClientPromise
}

let ipModifyService: IpModifyService | null = null

function ensureIpModifyService(): IpModifyService {
  if (!ipModifyService) {
    // 配置默认值占位（规范/设备文档确认后更新；将来从 db socket_config 读取）
    const config = { groupAddr: '239.0.0.1', groupPort: 6000, bindPort: 0 }
    ipModifyService = new IpModifyService(new MulticastUdpSocket(), new PlaceholderCodec(), config)
  }
  return ipModifyService
}

const wrapHttp = async <T>(fn: () => Promise<T> | T): Promise<T> => {
  try {
    return await fn()
  } catch (e) {
    throw e instanceof HttpError ? serializeHttpError(e) : e
  }
}

export function registerIpc(): void {
  ipcMain.handle(CHANNELS.ping, () => validate(pingResultSchema, { ok: true }))

  ipcMain.handle(CHANNELS.getVersion, () =>
    validate(versionResultSchema, {
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      platform: process.platform
    })
  )

  ipcMain.handle(SDK_CHANNELS.discover, async () => {
    const c = ensureClient()
    return c.discover()
  })

  const wrapAsync = async <T>(fn: () => Promise<T> | T): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      throw e instanceof DbError ? serializeDbError(e) : e
    }
  }

  ipcMain.handle(DB_CHANNELS.getAppConfig, (_e, key) =>
    wrapAsync(async () => {
      const c = await ensureDbClient()
      return c.getAppConfig(validate(dbKeySchema, key))
    })
  )
  ipcMain.handle(DB_CHANNELS.setAppConfig, (_e, key, value) =>
    wrapAsync(async () => {
      const c = await ensureDbClient()
      c.setAppConfig(validate(dbKeySchema, key), validate(dbValueSchema, value))
    })
  )
  ipcMain.handle(DB_CHANNELS.deleteAppConfig, (_e, key) =>
    wrapAsync(async () => {
      const c = await ensureDbClient()
      c.deleteAppConfig(validate(dbKeySchema, key))
    })
  )
  ipcMain.handle(DB_CHANNELS.listAppConfig, () =>
    wrapAsync(async () => {
      const c = await ensureDbClient()
      return c.listAppConfig()
    })
  )
  ipcMain.handle(DB_CHANNELS.getSecretConfig, (_e, key) =>
    wrapAsync(async () => {
      const c = await ensureDbClient()
      return c.getSecretConfig(validate(dbKeySchema, key))
    })
  )
  ipcMain.handle(DB_CHANNELS.setSecretConfig, (_e, key, value) =>
    wrapAsync(async () => {
      const c = await ensureDbClient()
      c.setSecretConfig(validate(dbKeySchema, key), validate(dbValueSchema, value))
    })
  )
  ipcMain.handle(DB_CHANNELS.deleteSecretConfig, (_e, key) =>
    wrapAsync(async () => {
      const c = await ensureDbClient()
      c.deleteSecretConfig(validate(dbKeySchema, key))
    })
  )
  ipcMain.handle(DB_CHANNELS.listSecretConfig, () =>
    wrapAsync(async () => {
      const c = await ensureDbClient()
      return c.listSecretConfig()
    })
  )

  ipcMain.handle(HTTP_CHANNELS.get, (_e, path, opts) =>
    wrapHttp(async () => {
      const c = await ensureHttpClient()
      return c.get(validate(httpPathSchema, path), validate(httpOptionsSchema, opts))
    })
  )
  ipcMain.handle(HTTP_CHANNELS.post, (_e, path, opts) =>
    wrapHttp(async () => {
      const c = await ensureHttpClient()
      return c.post(validate(httpPathSchema, path), validate(httpOptionsSchema, opts))
    })
  )
  ipcMain.handle(HTTP_CHANNELS.put, (_e, path, opts) =>
    wrapHttp(async () => {
      const c = await ensureHttpClient()
      return c.put(validate(httpPathSchema, path), validate(httpOptionsSchema, opts))
    })
  )
  ipcMain.handle(HTTP_CHANNELS.delete, (_e, path, opts) =>
    wrapHttp(async () => {
      const c = await ensureHttpClient()
      return c.delete(validate(httpPathSchema, path), validate(httpOptionsSchema, opts))
    })
  )
  ipcMain.handle(HTTP_CHANNELS.setToken, (_e, token) =>
    wrapHttp(async () => {
      const c = await ensureHttpClient()
      await c.tokens.setToken(token)
    })
  )
  ipcMain.handle(HTTP_CHANNELS.setRefreshToken, (_e, token) =>
    wrapHttp(async () => {
      const c = await ensureHttpClient()
      await c.tokens.setRefreshToken(token)
    })
  )
  ipcMain.handle(HTTP_CHANNELS.clearTokens, () =>
    wrapHttp(async () => {
      const c = await ensureHttpClient()
      await c.tokens.clear()
    })
  )
  ipcMain.handle(HTTP_CHANNELS.setConfig, (_e, config) =>
    wrapHttp(async () => {
      const db = await ensureDbClient()
      const configStore = new DbHttpConfig({
        getAppConfig: async (key) => db.getAppConfig(key),
        setAppConfig: async (key, value) => db.setAppConfig(key, value)
      })
      await configStore.set(validate(httpConfigSchema, config))
      httpClient = null
      httpClientPromise = null
    })
  )

  const wrapUseCase = async <T>(fn: () => Promise<T> | T): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof UseCaseError) throw serializeUseCaseError(e)
      if (e instanceof DbError) throw serializeDbError(e)
      if (e instanceof HttpError) throw serializeHttpError(e)
      throw e
    }
  }

  ipcMain.handle(USE_CASE_CHANNELS.configLoadAuth, () =>
    wrapUseCase(async () => {
      const services = {
        sdk: await ensureClient(),
        db: await ensureDbClient(),
        http: await ensureHttpClient()
      }
      const uc = new ConfigLoadAuthUseCase(services)
      return uc.execute()
    })
  )

  const wrapSocket = async <T>(fn: () => Promise<T> | T): Promise<T> => {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof SocketError) throw serializeSocketError(e)
      throw e
    }
  }

  ipcMain.handle(SOCKET_CHANNELS.modifyIp, (_e, params) =>
    wrapSocket(async () => {
      const s = ensureIpModifyService()
      return s.modifyDeviceIp(validate(ipModifyParamsSchema, params))
    })
  )
}
