import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, SDK_CHANNELS, DB_CHANNELS, HTTP_CHANNELS, USE_CASE_CHANNELS } from '@shared/ipc/channels'
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
  },
  db: {
    getAppConfig: (key) => ipcRenderer.invoke(DB_CHANNELS.getAppConfig, key),
    setAppConfig: (key, value) => ipcRenderer.invoke(DB_CHANNELS.setAppConfig, key, value),
    deleteAppConfig: (key) => ipcRenderer.invoke(DB_CHANNELS.deleteAppConfig, key),
    listAppConfig: () => ipcRenderer.invoke(DB_CHANNELS.listAppConfig),
    getSecretConfig: (key) => ipcRenderer.invoke(DB_CHANNELS.getSecretConfig, key),
    setSecretConfig: (key, value) => ipcRenderer.invoke(DB_CHANNELS.setSecretConfig, key, value),
    deleteSecretConfig: (key) => ipcRenderer.invoke(DB_CHANNELS.deleteSecretConfig, key),
    listSecretConfig: () => ipcRenderer.invoke(DB_CHANNELS.listSecretConfig)
  },
  http: {
    get: (path, opts) => ipcRenderer.invoke(HTTP_CHANNELS.get, path, opts),
    post: (path, opts) => ipcRenderer.invoke(HTTP_CHANNELS.post, path, opts),
    put: (path, opts) => ipcRenderer.invoke(HTTP_CHANNELS.put, path, opts),
    delete: (path, opts) => ipcRenderer.invoke(HTTP_CHANNELS.delete, path, opts),
    setToken: (token) => ipcRenderer.invoke(HTTP_CHANNELS.setToken, token),
    setRefreshToken: (token) => ipcRenderer.invoke(HTTP_CHANNELS.setRefreshToken, token),
    clearTokens: () => ipcRenderer.invoke(HTTP_CHANNELS.clearTokens)
  },
  useCase: {
    scanAndUpload: (params) => ipcRenderer.invoke(USE_CASE_CHANNELS.scanAndUpload, params),
    configLoadAuth: () => ipcRenderer.invoke(USE_CASE_CHANNELS.configLoadAuth)
  }
}

contextBridge.exposeInMainWorld('api', api)
