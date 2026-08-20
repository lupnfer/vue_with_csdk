import { describe, it, expect } from 'vitest'
import { SocketError, serializeSocketError, deserializeSocketError } from '../../src/main/socket-service/errors'

describe('SocketError', () => {
  it('构造保留 code/category/retryable', () => {
    const err = new SocketError('SOCKET_SEND_FAILED', 'send', 'boom', true)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('SocketError')
    expect(err.code).toBe('SOCKET_SEND_FAILED')
    expect(err.category).toBe('send')
    expect(err.retryable).toBe(true)
    expect(err.message).toBe('boom')
  })

  it('serialize/deserialize 往返一致', () => {
    const err = new SocketError('SOCKET_CODEC_CRC', 'codec', 'crc mismatch', false)
    const restored = deserializeSocketError(serializeSocketError(err))
    expect(restored).toBeInstanceOf(SocketError)
    expect(restored.code).toBe('SOCKET_CODEC_CRC')
    expect(restored.category).toBe('codec')
    expect(restored.retryable).toBe(false)
    expect(restored.message).toBe('crc mismatch')
  })
})
