import { app, ipcMain } from 'electron'
import { CHANNELS, pingResultSchema, versionResultSchema } from '@shared/ipc/channels'
import { validate } from '@shared/ipc/validate'

export function registerIpc(): void {
  ipcMain.handle(CHANNELS.ping, () => {
    return validate(pingResultSchema, { ok: true })
  })

  ipcMain.handle(CHANNELS.getVersion, () => {
    return validate(versionResultSchema, {
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      platform: process.platform
    })
  })
}
