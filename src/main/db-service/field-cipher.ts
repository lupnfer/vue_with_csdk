import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const IV_LEN = 12
const TAG_LEN = 16

/** 加密：返回 iv(12) + tag(16) + ciphertext 的连续 Buffer */
export function encryptField(plaintext: string, key: Buffer): Buffer {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ciphertext])
}

/** 解密：从 iv(12) + tag(16) + ciphertext 还原明文 */
export function decryptField(blob: Buffer, key: Buffer): string {
  const iv = blob.subarray(0, IV_LEN)
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ciphertext = blob.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}
