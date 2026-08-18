import { parentPort } from 'node:worker_threads'
import { selectBinding } from '../binding-selector'
import type { InvokeMessage, ResultMessage, EventMessage } from '../transport/types'
import type { SerializedError } from '../errors'

const sdkBinding = selectBinding()

function post(msg: ResultMessage | EventMessage): void {
  parentPort?.postMessage(msg)
}

function ok(id: number, data: unknown): void {
  post({ type: 'result', id, ok: true, data })
}

function fail(id: number, error: SerializedError): void {
  post({ type: 'result', id, ok: false, error })
}

parentPort?.on('message', (msg: InvokeMessage) => {
  try {
    switch (msg.method) {
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
