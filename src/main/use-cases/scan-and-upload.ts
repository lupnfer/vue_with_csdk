import type { Services } from './services'
import type { ScanParams, ScanResult } from './types'
import type { Session, Handle, SdkEvent } from '../sdk-service/types'
import { UseCaseError, wrapServiceError } from './errors'

const EXPECTED_EVENTS = 2
const EVENT_TIMEOUT_MS = 3000

export class ScanAndUploadUseCase {
  constructor(private readonly services: Services) {}

  async execute(params: ScanParams): Promise<ScanResult> {
    const { sdk, db, http } = this.services
    let session: Session | null = null
    let handle: Handle | null = null
    const events: SdkEvent[] = []
    let listener: ((e: SdkEvent) => void) | null = null

    try {
      // 1. sdk.init
      try {
        session = await sdk.init(params.sdkConfig)
      } catch (e) {
        throw wrapServiceError(e, 'sdk')
      }
      // 2. sdk.open
      try {
        handle = await sdk.open(session)
      } catch (e) {
        throw wrapServiceError(e, 'sdk')
      }
      // 3. 注册事件收集（保存引用，finally 中移除，防监听器泄漏）
      listener = (e: SdkEvent): void => {
        events.push(e)
      }
      sdk.on('event', listener)
      // 4. sdk.startScan
      try {
        await sdk.startScan(handle)
      } catch (e) {
        throw wrapServiceError(e, 'sdk')
      }
      // 5. 等待回调完成（轮询 events 数量到预期，或超时）
      const deadline = Date.now() + EVENT_TIMEOUT_MS
      while (events.length < EXPECTED_EVENTS && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20))
      }
      if (events.length < EXPECTED_EVENTS) {
        throw new UseCaseError('orchestration', `event timeout: only ${events.length}/${EXPECTED_EVENTS} received`)
      }
      // 6. db 落库
      try {
        db.setAppConfig('last_scan', JSON.stringify(events))
      } catch (e) {
        throw wrapServiceError(e, 'db')
      }
      // 7. http 上传
      let uploaded = false
      let uploadResponse: unknown
      try {
        const res = await http.post(params.uploadUrl, { body: { sessionId: session.id, events } })
        uploaded = true
        uploadResponse = res.body
      } catch (e) {
        throw wrapServiceError(e, 'http')
      }
      // 8. 返回
      return { sessionId: session.id, handleId: handle.id, events, uploaded, uploadResponse }
    } finally {
      // 清理：无论成功失败都移除监听器 + dispose（防监听器与句柄泄漏）
      if (listener) {
        try { sdk.off('event', listener) } catch { /* 清理失败不覆盖原错误 */ }
      }
      if (handle) {
        try { await sdk.dispose(handle) } catch { /* 清理失败不覆盖原错误 */ }
      }
      if (session) {
        try { await sdk.disposeSession(session) } catch { /* 同上 */ }
      }
    }
  }
}
