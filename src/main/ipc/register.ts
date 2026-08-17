import { app, ipcMain, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { CHANNELS, pingResultSchema, versionResultSchema, SDK_CHANNELS, sdkConfigSchema, sdkSessionSchema, sdkHandleSchema, DB_CHANNELS, dbKeySchema, dbValueSchema, HTTP_CHANNELS, httpPathSchema, httpOptionsSchema } from '@shared/ipc/channels'
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
import { USE_CASE_CHANNELS, scanParamsSchema } from '@shared/ipc/channels'
import { ScanAndUploadUseCase } from '../use-cases/scan-and-upload'
import { ConfigLoadAuthUseCase } from '../use-cases/config-load-auth'
import { UseCaseError, serializeUseCaseError } from '../use-cases/errors'

let client: SdkClient | null = null

function ensureClient(): SdkClient {
  if (!client) {
    client = new SdkClient(new WorkerTransport())
    client.on('event', (e) => {
      // 广播事件到所有渲染窗口
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(SDK_CHANNELS.event, e)
      }
    })
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
      // db 的 getAppConfig/setAppConfig 为同步方法，AppConfigStore 要求 Promise，故做适配。
      const configStore = new DbHttpConfig({
        getAppConfig: async (key) => db.getAppConfig(key),
        setAppConfig: async (key, value) => db.setAppConfig(key, value)
      })
      // db 的 secret 方法名为 getSecretConfig/setSecretConfig（同步），SecretStore 要求 getSecret/setSecret（Promise），故做适配。
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

  ipcMain.handle(SDK_CHANNELS.init, (_e, config) => {
    const c = ensureClient()
    return c.init(validate(sdkConfigSchema, config))
  })
  ipcMain.handle(SDK_CHANNELS.open, (_e, sessionId) => {
    const { id } = validate(sdkSessionSchema, { id: sessionId })
    return ensureClient().open({ id })
  })
  ipcMain.handle(SDK_CHANNELS.startScan, (_e, handleId) => {
    const { id } = validate(sdkHandleSchema, { id: handleId })
    return ensureClient().startScan({ id })
  })
  ipcMain.handle(SDK_CHANNELS.dispose, (_e, handleId) => {
    const { id } = validate(sdkHandleSchema, { id: handleId })
    return ensureClient().dispose({ id })
  })
  ipcMain.handle(SDK_CHANNELS.disposeSession, (_e, sessionId) => {
    const { id } = validate(sdkSessionSchema, { id: sessionId })
    return ensureClient().disposeSession({ id })
  })
  ipcMain.handle(SDK_CHANNELS.discover, async () => {
    const c = ensureClient()
    return c.discover()
  })

  // 包裹整个 handler（含 ensureDbClient 的 open 失败）：DbError 序列化为可跨 IPC 的普通对象。
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

  // ---- HTTP ----
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

  // ---- USE_CASE ----
  // 包裹整个 handler：UseCaseError 序列化；服务初始化抛出的 DbError/HttpError 也序列化
  // （ensureDbClient/ensureHttpClient 的 open 失败），统一成可跨 IPC 的普通对象。
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

  ipcMain.handle(USE_CASE_CHANNELS.scanAndUpload, (_e, params) =>
    wrapUseCase(async () => {
      const services = {
        sdk: await ensureClient(),
        db: await ensureDbClient(),
        http: await ensureHttpClient()
      }
      const uc = new ScanAndUploadUseCase(services)
      return uc.execute(validate(scanParamsSchema, params))
    })
  )
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
}
