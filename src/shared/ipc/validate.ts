import { z } from 'zod'

export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new Error(`IPC 数据校验失败: ${result.error.message}`)
  }
  return result.data
}
