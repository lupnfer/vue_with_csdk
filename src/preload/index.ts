import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, SDK_CHANNELS } from '@shared/ipc/channels'
import type { RendererApi } from '@shared/ipc/api'

const api: RendererApi = {
  ping: () => ipcRenderer.invoke(CHANNELS.ping) as Promise<{ ok: boolean }>,
  getVersion: () => ipcRenderer.invoke(CHANNELS.getVersion),
  sdk: {
    init: (config) => ipcRenderer.invoke(SDK_CHANNELS.init, config),
    open: (sessionId) => ipcRenderer.invoke(SDK_CHANNELS.open, sessionId),
    startScan: (handleId) => ipcRenderer.invoke(SDK_CHANNELS.startScan, handleId),
    dispose: (handleId) => ipcRenderer.invoke(SDK_CHANNELS.dispose, handleId),
    disposeSession: (sessionId) => ipcRenderer.invoke(SDK_CHANNELS.disposeSession, sessionId),
    on: (event, cb) => {
      const handler = (_e: unknown, data: Parameters<typeof cb>[0]): void => cb(data)
      ipcRenderer.on(SDK_CHANNELS.event, handler)
      return () => ipcRenderer.removeListener(SDK_CHANNELS.event, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
