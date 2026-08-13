import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(process.cwd(), 'src/shared'),
      '@': resolve(process.cwd(), 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/sdk/**/*.test.ts'],
    testTimeout: 10000
  }
})
