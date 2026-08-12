import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type { RendererApi } from '@shared/ipc/api'

const api: RendererApi = {
  ping: () => ipcRenderer.invoke(CHANNELS.ping) as Promise<{ ok: boolean }>,
  getVersion: () => ipcRenderer.invoke(CHANNELS.getVersion)
}

contextBridge.exposeInMainWorld('api', api)
