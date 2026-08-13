import { z } from 'zod'

export const CHANNELS = {
  ping: 'app:ping',
  getVersion: 'app:get-version'
} as const

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS]

export const pingResultSchema = z.object({
  ok: z.boolean()
})

export const versionResultSchema = z.object({
  version: z.string(),
  electron: z.string(),
  platform: z.string()
})

export type VersionInfo = z.infer<typeof versionResultSchema>

// ---- SDK ----
export const SDK_CHANNELS = {
  init: 'sdk:init',
  open: 'sdk:open',
  startScan: 'sdk:start-scan',
  dispose: 'sdk:dispose',
  disposeSession: 'sdk:dispose-session',
  event: 'sdk-events'
} as const

export type SdkChannelName = (typeof SDK_CHANNELS)[keyof typeof SDK_CHANNELS]

export const sdkConfigSchema = z.object({
  mode: z.number().int(),
  logger: z.object({ level: z.number().int(), prefix: z.string() })
})

export const sdkSessionSchema = z.object({ id: z.number().int() })
export const sdkHandleSchema = z.object({ id: z.number().int() })
export const sdkEventSchema = z.object({
  handleId: z.number().int(),
  eventType: z.number().int(),
  payload: z.string()
})
