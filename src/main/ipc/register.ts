import { app, ipcMain, BrowserWindow } from 'electron'
import { CHANNELS, pingResultSchema, versionResultSchema, SDK_CHANNELS, sdkConfigSchema, sdkSessionSchema, sdkHandleSchema } from '@shared/ipc/channels'
import { validate } from '@shared/ipc/validate'
import { WorkerTransport } from '../sdk-service/transport/worker-transport'
import { SdkClient } from '../sdk-service/sdk-client'

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
}
