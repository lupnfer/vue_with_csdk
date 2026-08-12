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
