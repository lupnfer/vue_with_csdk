import { describe, it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encryptField, decryptField } from '../../src/main/db-service/field-cipher'

describe('field-cipher', () => {
  it('加密后解密往返一致', () => {
    const key = randomBytes(32)
    const blob = encryptField('hello secret', key)
    expect(decryptField(blob, key)).toBe('hello secret')
  })

  it('密文是 Buffer 且与明文不同', () => {
    const key = randomBytes(32)
    const blob = encryptField('plain', key)
    expect(Buffer.isBuffer(blob)).toBe(true)
    expect(blob.includes(Buffer.from('plain'))).toBe(false)
  })

  it('错误密钥解密失败（GCM tag 校验）', () => {
    const blob = encryptField('secret', randomBytes(32))
    expect(() => decryptField(blob, randomBytes(32))).toThrow()
  })

  it('空字符串能处理', () => {
    const key = randomBytes(32)
    const blob = encryptField('', key)
    expect(decryptField(blob, key)).toBe('')
  })

  it('两次加密同一明文产生不同密文（随机 iv）', () => {
    const key = randomBytes(32)
    const a = encryptField('same', key)
    const b = encryptField('same', key)
    expect(a.equals(b)).toBe(false)
  })
})
