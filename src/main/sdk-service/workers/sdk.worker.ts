import { parentPort } from 'node:worker_threads'
import {
  crcInit,
  crcOpen,
  crcStartScan,
  crcRelease,
  crcClose,
  crcVersion,
  registerCallback,
  unregisterCallback
} from '../binding'
import { selectBinding } from '../binding-selector'
import type { InvokeMessage, ResultMessage, EventMessage } from '../transport/types'
import { translateError, serializeError, type SdkErrorCategory, type SerializedError } from '../errors'

// binding 选择：CRC_SDK_MODE=real 用真实 SDK，否则 mock。worker 内单例。
const sdkBinding = selectBinding()

// id ↔ 指针 注册表（指针只在 worker 内持有与释放）
const sessions = new Map<number, unknown>()     // id → session ptr
const handles = new Map<number, unknown>()      // id → handle ptr
const handleCallbacks = new Map<number, bigint>() // handle id → koffi 注册 id
let nextId = 1

function allocId(): number {
  return nextId++
}

function post(msg: ResultMessage | EventMessage): void {
  parentPort?.postMessage(msg)
}

function ok(id: number, data: unknown): void {
  post({ type: 'result', id, ok: true, data })
}

function fail(id: number, error: SerializedError): void {
  post({ type: 'result', id, ok: false, error })
}

/** 把 C 返回码（非 0）翻译成序列化错误：走 errors.ts 的 RULES（-1/-2/-3 等）。 */
function failFromRc(id: number, rc: number, category: SdkErrorCategory, what: string): void {
  fail(id, serializeError(translateError({ code: rc, category, raw: `${what} rc=${rc}` })))
}

parentPort?.on('message', (msg: InvokeMessage) => {
  try {
    switch (msg.method) {
      case 'version': {
        ok(msg.id, crcVersion())
        break
      }
      case 'init': {
        const [config] = msg.args as [{ mode: number; logger: { level: number; prefix: string } }]
        const ptr = crcInit(config)
        if (!ptr) {
          fail(msg.id, { code: 'SDK_INIT_FAILED', category: 'init', message: 'init returned NULL', retryable: false })
          return
        }
        const id = allocId()
        sessions.set(id, ptr)
        ok(msg.id, { id })
        break
      }
      case 'open': {
        const [sessionId] = msg.args as [number]
        const sessionPtr = sessions.get(sessionId)
        if (!sessionPtr) {
          fail(msg.id, { code: 'SDK_NO_SESSION', category: 'call', message: 'session not found', retryable: false })
          return
        }
        const handleId = allocId()
        // 注册回调：投递到主进程
        const cb = (eventType: number, payload: string, _userData: unknown): void => {
          post({ type: 'event', data: { handleId, eventType, payload } })
        }
        const regId = registerCallback(cb)
        // 把注册得到的指针传给 open_params.cb，而非 JS 函数本身。
        // koffi 对直接传入 struct 字段的 JS 函数按 transient 处理（crcOpen 返回即失效），
        // 而 startScan 会在后续 pthread 上调用回调——必须用 registered 指针才安全。
        const ptr = crcOpen(sessionPtr, { cb: regId, user_data: null })
        if (!ptr) {
          unregisterCallback(regId)
          fail(msg.id, { code: 'SDK_OPEN_FAILED', category: 'call', message: 'open returned NULL', retryable: false })
          return
        }
        handles.set(handleId, ptr)
        handleCallbacks.set(handleId, regId)
        ok(msg.id, { id: handleId })
        break
      }
      case 'start': {
        const [handleId] = msg.args as [number]
        const ptr = handles.get(handleId)
        if (!ptr) {
          fail(msg.id, { code: 'SDK_CALL_FAILED', category: 'call', message: 'handle not found', retryable: false })
          return
        }
        const rc = crcStartScan(ptr) as number
        if (rc !== 0) {
          failFromRc(msg.id, rc, 'call', 'start')
          return
        }
        ok(msg.id, null)   // 立即返回；结果走回调事件
        break
      }
      case 'release': {
        const [handleId] = msg.args as [number]
        const ptr = handles.get(handleId)
        if (!ptr) {
          fail(msg.id, { code: 'SDK_ALREADY_RELEASED', category: 'memory', message: 'handle not found', retryable: false })
          return
        }
        const rc = crcRelease(ptr) as number
        if (rc !== 0) {
          failFromRc(msg.id, rc, 'memory', 'release')
          return
        }
        const regId = handleCallbacks.get(handleId)
        if (regId !== undefined) {
          unregisterCallback(regId)
          handleCallbacks.delete(handleId)
        }
        handles.delete(handleId)
        ok(msg.id, null)
        break
      }
      case 'close': {
        const [sessionId] = msg.args as [number]
        const ptr = sessions.get(sessionId)
        if (!ptr) {
          fail(msg.id, { code: 'SDK_ALREADY_RELEASED', category: 'memory', message: 'session not found', retryable: false })
          return
        }
        const rc = crcClose(ptr) as number
        if (rc !== 0) {
          failFromRc(msg.id, rc, 'memory', 'close')
          return
        }
        sessions.delete(sessionId)
        ok(msg.id, null)
        break
      }
      case 'closeAll': {
        const leakedHandles = [...handles.keys()]
        const leakedSessions = [...sessions.keys()]
        if (leakedHandles.length || leakedSessions.length) {
          // POC：仅打日志，不硬失败
          post({
            type: 'event',
            data: { kind: 'leak', handles: leakedHandles, sessions: leakedSessions }
          })
        }
        // 清理所有回调注册
        for (const regId of handleCallbacks.values()) unregisterCallback(regId)
        handleCallbacks.clear()
        handles.clear()
        sessions.clear()
        ok(msg.id, { handles: leakedHandles.length, sessions: leakedSessions.length })
        break
      }
      case 'discover': {
        try {
          const devices = sdkBinding.discoverDevicesByMulticast()
          ok(msg.id, devices)
        } catch (e) {
          fail(msg.id, {
            code: 'SDK_CALL_FAILED',
            category: 'call',
            message: e instanceof Error ? e.message : String(e),
            retryable: false
          })
        }
        break
      }
      case 'cleanup': {
        try {
          sdkBinding.cleanup()
          ok(msg.id, null)
        } catch (e) {
          fail(msg.id, {
            code: 'SDK_CALL_FAILED',
            category: 'call',
            message: e instanceof Error ? e.message : String(e),
            retryable: false
          })
        }
        break
      }
      default: {
        fail(msg.id, { code: 'SDK_UNKNOWN_METHOD', category: 'call', message: `unknown method ${msg.method}`, retryable: false })
      }
    }
  } catch (e) {
    fail(msg.id, {
      code: 'SDK_UNKNOWN',
      category: 'unknown',
      message: e instanceof Error ? e.message : String(e),
      retryable: true
    })
  }
})
