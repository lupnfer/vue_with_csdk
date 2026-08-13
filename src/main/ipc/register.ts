import { app, ipcMain, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { CHANNELS, pingResultSchema, versionResultSchema, SDK_CHANNELS, sdkConfigSchema, sdkSessionSchema, sdkHandleSchema, DB_CHANNELS, dbKeySchema, dbValueSchema } from '@shared/ipc/channels'
import { validate } from '@shared/ipc/validate'
import { WorkerTransport } from '../sdk-service/transport/worker-transport'
import { SdkClient } from '../sdk-service/sdk-client'
import { DbClient } from '../db-service/db-client'
import { SafeStorageKeyProvider } from '../db-service/key-provider'
import { DbError, serializeDbError } from '../db-service/errors'

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

  const wrap = <T>(fn: () => T): T => {
    try {
      return fn()
    } catch (e) {
      throw e instanceof DbError ? serializeDbError(e) : e
    }
  }

  ipcMain.handle(DB_CHANNELS.getAppConfig, async (_e, key) => {
    const c = await ensureDbClient()
    return wrap(() => c.getAppConfig(validate(dbKeySchema, key)))
  })
  ipcMain.handle(DB_CHANNELS.setAppConfig, async (_e, key, value) => {
    const c = await ensureDbClient()
    wrap(() => c.setAppConfig(validate(dbKeySchema, key), validate(dbValueSchema, value)))
  })
  ipcMain.handle(DB_CHANNELS.deleteAppConfig, async (_e, key) => {
    const c = await ensureDbClient()
    wrap(() => c.deleteAppConfig(validate(dbKeySchema, key)))
  })
  ipcMain.handle(DB_CHANNELS.listAppConfig, async () => {
    const c = await ensureDbClient()
    return wrap(() => c.listAppConfig())
  })
  ipcMain.handle(DB_CHANNELS.getSecretConfig, async (_e, key) => {
    const c = await ensureDbClient()
    return wrap(() => c.getSecretConfig(validate(dbKeySchema, key)))
  })
  ipcMain.handle(DB_CHANNELS.setSecretConfig, async (_e, key, value) => {
    const c = await ensureDbClient()
    wrap(() => c.setSecretConfig(validate(dbKeySchema, key), validate(dbValueSchema, value)))
  })
  ipcMain.handle(DB_CHANNELS.deleteSecretConfig, async (_e, key) => {
    const c = await ensureDbClient()
    wrap(() => c.deleteSecretConfig(validate(dbKeySchema, key)))
  })
  ipcMain.handle(DB_CHANNELS.listSecretConfig, async () => {
    const c = await ensureDbClient()
    return wrap(() => c.listSecretConfig())
  })
}
