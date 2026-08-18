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
    globals: true,
    exclude: ['.worktrees/**', 'node_modules/**'],
    // electron 二进制未安装时，require('electron') 会触发 spawnSync 下载（~10s/次）。
    // 设置 ELECTRON_OVERRIDE_DIST_PATH 使其直接返回字符串路径（非 API），与计划预期的
    // 非 Electron 环境行为一致：electron?.safeStorage 为 undefined。
    env: {
      ELECTRON_OVERRIDE_DIST_PATH: '/tmp/dummy-electron'
    }
  }
})
