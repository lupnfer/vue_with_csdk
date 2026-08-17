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
  discover: 'sdk:discover',
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

export const discoveredDeviceSchema = z.object({
  mac: z.string(),
  type: z.string(),
  version: z.string(),
  name: z.string(),
  ip: z.string(),
  mask: z.string(),
  gateway: z.string(),
  serialNumber: z.string(),
  dhcpEnabled: z.number(),
  publicVersion: z.string(),
  isActive: z.boolean()
})
export const discoveredDeviceListSchema = z.array(discoveredDeviceSchema)

// ---- DB ----
export const DB_CHANNELS = {
  getAppConfig: 'db:get-app-config',
  setAppConfig: 'db:set-app-config',
  deleteAppConfig: 'db:delete-app-config',
  listAppConfig: 'db:list-app-config',
  getSecretConfig: 'db:get-secret-config',
  setSecretConfig: 'db:set-secret-config',
  deleteSecretConfig: 'db:delete-secret-config',
  listSecretConfig: 'db:list-secret-config'
} as const

export type DbChannelName = (typeof DB_CHANNELS)[keyof typeof DB_CHANNELS]

export const dbKeySchema = z.string().min(1)
export const dbValueSchema = z.string()
export const dbConfigEntrySchema = z.object({
  key: z.string(),
  value: z.string(),
  updatedAt: z.string()
})
export const dbConfigListSchema = z.array(dbConfigEntrySchema)

// ---- HTTP ----
export const HTTP_CHANNELS = {
  get: 'http:get',
  post: 'http:post',
  put: 'http:put',
  delete: 'http:delete',
  setToken: 'http:set-token',
  setRefreshToken: 'http:set-refresh-token',
  clearTokens: 'http:clear-tokens',
  setConfig: 'http:set-config'
} as const

export type HttpChannelName = (typeof HTTP_CHANNELS)[keyof typeof HTTP_CHANNELS]

export const httpPathSchema = z.string().min(1)
export const httpBodySchema = z.any()
export const httpHeadersSchema = z.record(z.string(), z.string()).optional()
export const httpOptionsSchema = z.object({
  headers: httpHeadersSchema,
  body: httpBodySchema,
  timeoutMs: z.number().int().positive().optional()
}).optional()

export const httpConfigSchema = z.object({
  baseUrl: z.string(),
  refreshUrl: z.string(),
  timeoutMs: z.number().int().positive().optional(),
  maxRetries: z.number().int().positive().optional()
})

// ---- USE_CASE ----
export const USE_CASE_CHANNELS = {
  scanAndUpload: 'use-case:scan-and-upload',
  configLoadAuth: 'use-case:config-load-auth'
} as const

export type UseCaseChannelName = (typeof USE_CASE_CHANNELS)[keyof typeof USE_CASE_CHANNELS]

export const scanParamsSchema = z.object({
  sdkConfig: sdkConfigSchema,
  uploadUrl: z.string().min(1)
})
