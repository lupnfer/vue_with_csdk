import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import log from 'electron-log'
import { createWebPreferences, buildCsp } from './security'
import { registerIpc, getDbClient } from './ipc/register'
import { selectBinding } from './sdk-service/binding-selector'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: createWebPreferences()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function focusMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
}

function applyCsp(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildCsp()]
      }
    })
  })
}

log.transports.file.resolvePathFn = () => join(app.getPath('userData'), 'logs', 'main.log')
log.transports.file.maxSize = 10 * 1024 * 1024
log.transports.console.level = 'debug'
log.info('[app] starting', app.getVersion())

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())

  app.whenReady().then(() => {
    if (app.isPackaged) applyCsp()
    registerIpc()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  let isQuitting = false

  app.on('before-quit', (event) => {
    if (isQuitting) return
    event.preventDefault()
    isQuitting = true
    void (async () => {
      try {
        const db = getDbClient()
        if (db) {
          db.close()
          log.info('[app] database closed')
        }
      } catch (e) {
        log.error('[app] error closing database:', e)
      }
      try {
        selectBinding().cleanup()
        log.info('[app] sdk cleaned up')
      } catch (e) {
        log.error('[app] error cleaning up sdk:', e)
      }
      app.exit(0)
    })()
  })
}
