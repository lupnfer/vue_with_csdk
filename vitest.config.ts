import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@shared': resolve(process.cwd(), 'src/shared'),
      '@': resolve(process.cwd(), 'src/renderer/src')
    }
  },
  test: {
    environment: 'jsdom',
    globals: true
  }
})
