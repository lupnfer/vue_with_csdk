# 工程脚手架实施计划（子计划 1/6）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Electron + Vue 3 + TypeScript 工程骨架：可开发、可构建、可测试，主进程/Preload/渲染进程三端跑通一条最小 IPC 链路，并落实安全基线。

**Architecture:** electron-vite 三目标构建（main / preload / renderer）；主进程只做窗口与系统能力，渲染进程通过 preload 暴露的白名单 API 通信；IPC 通道与参数校验统一定义在 `src/shared/`，两侧共享；C SDK、数据库、网络层在后续子计划中挂到主进程。

**Tech Stack:** Electron、electron-vite、Vue 3、TypeScript（strict）、Pinia、Vue Router、zod、Vitest + @vue/test-utils（jsdom）。

## Global Constraints

- Node.js >= 22.12（electron-vite 要求），npm 解析到的最新稳定版为准，安装后提交 `package-lock.json`。
- TypeScript 全链路，`strict: true`；主/渲染两侧的 IPC 契约只定义在 `src/shared/`。
- 渲染进程安全基线：`contextIsolation: true`、`nodeIntegration: false`；生产环境注入 CSP，开发环境不注入（HMR 需要）。
- 目录别名：主进程与 preload 用 `@shared`；渲染进程用 `@shared` 与 `@`。
- 目标平台为 Windows，但开发可在 macOS/Linux 进行；本计划所有验证命令在本机可执行。
- 提交信息使用 Conventional Commits（`feat:` / `fix:` / `chore:` / `test:`）。
- `npm install` 需要网络，若沙箱受限需请求提权；Electron 二进制下载慢时可设 `ELECTRON_MIRROR` 镜像。

---

## 文件结构（本子计划创建/修改）

- `package.json` — 工程元信息、脚本、依赖
- `electron.vite.config.ts` — 三目标构建配置与别名
- `tsconfig.json` / `tsconfig.node.json` / `tsconfig.web.json` — TS 工程配置
- `vitest.config.ts` — 测试环境（jsdom）与别名
- `src/main/index.ts` — 应用入口、窗口、单实例
- `src/main/security.ts` — WebPreferences 与 CSP 策略
- `src/main/ipc/register.ts` — IPC handler 注册
- `src/preload/index.ts` — contextBridge 白名单 API
- `src/shared/ipc/channels.ts` — 通道名 + zod schema + 类型
- `src/shared/ipc/validate.ts` — IPC 参数校验工具
- `src/shared/ipc/api.ts` — 渲染进程可见 API 接口
- `src/renderer/index.html` — 渲染入口 HTML
- `src/renderer/src/main.ts` — Vue 应用装配
- `src/renderer/src/App.vue` — 根组件
- `src/renderer/src/router.ts` — hash 路由
- `src/renderer/src/views/HomeView.vue` — 首页占位
- `src/renderer/src/stores/app.ts` — 应用信息 store
- `src/renderer/src/env.d.ts` — `window.api` 类型声明
- `tests/main/security.test.ts` — 安全配置单测
- `tests/shared/ipc/validate.test.ts` — IPC 校验单测
- `tests/renderer/home-view.test.ts` — 组件单测
- `README.md` — 开发/构建/测试说明

---

### Task 1: 工程初始化与最小可构建骨架

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.ts`, `src/renderer/src/App.vue`

**Interfaces:**
- Consumes: 无
- Produces: `npm run dev` / `npm run build` / `npm run typecheck` / `npm test` 四个脚本可用；`src/main/index.ts` 创建 800x600 主窗口并加载渲染入口。

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "code-reader-client",
  "version": "0.1.0",
  "description": "Vue 3 桌面客户端（Electron + C SDK + SQLCipher）",
  "main": "out/main/index.js",
  "private": true,
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "typecheck": "vue-tsc --noEmit -p tsconfig.web.json && tsc --noEmit -p tsconfig.node.json",
    "test": "vitest run"
  }
}
```

- [ ] **Step 2: 创建 TS 配置**

`tsconfig.json`：

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

`tsconfig.node.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["electron.vite.config.ts", "src/main/**/*", "src/preload/**/*", "src/shared/**/*"]
}
```

`tsconfig.web.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "vitest/globals"],
    "baseUrl": ".",
    "paths": { "@shared/*": ["src/shared/*"], "@/*": ["src/renderer/src/*"] }
  },
  "include": ["src/renderer/src/**/*", "src/shared/**/*", "tests/renderer/**/*"]
}
```

- [ ] **Step 3: 创建 electron.vite.config.ts 与 vitest.config.ts**

`electron.vite.config.ts`：

```ts
import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  preload: {
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [vue()]
  }
})
```

`vitest.config.ts`：

```ts
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
```

- [ ] **Step 4: 创建最小三端入口**

`src/main/index.ts`：

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js')
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

`src/preload/index.ts`：

```ts
export {}
```

`src/renderer/index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>Code Reader Client</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/renderer/src/main.ts`：

```ts
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
```

`src/renderer/src/App.vue`：

```vue
<template>
  <h1>Code Reader Client</h1>
</template>
```

- [ ] **Step 5: 安装依赖**

```bash
npm install vue pinia vue-router zod
npm install -D electron electron-vite vite @vitejs/plugin-vue typescript vue-tsc vitest @vue/test-utils jsdom @types/node
```

预期：安装成功，生成 `package-lock.json`。

- [ ] **Step 6: 验证构建与类型检查**

```bash
npm run typecheck
npm run build
```

预期：typecheck 通过；`npm run build` 产出 `out/main/index.js`、`out/preload/index.js`、`out/renderer/index.html`。

- [ ] **Step 7: 手动冒烟（可选，本机有显示环境时）**

```bash
npm run dev
```

预期：弹出 800x600 窗口，显示 “Code Reader Client”。

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json electron.vite.config.ts vitest.config.ts tsconfig.json tsconfig.node.json tsconfig.web.json src
git commit -m "feat: 初始化 electron-vite 工程骨架"
```

---

### Task 2: 安全基线（WebPreferences 与 CSP）

**Files:**
- Create: `src/main/security.ts`, `tests/main/security.test.ts`
- Modify: `src/main/index.ts`（窗口使用安全配置、加单实例锁、生产环境注入 CSP）

**Interfaces:**
- Consumes: 无
- Produces:
  - `createWebPreferences(): Electron.WebPreferences` — 返回 `{ preload, sandbox: false, contextIsolation: true, nodeIntegration: false }`
  - `buildCsp(): string` — 生产环境 CSP 策略字符串
  - `registerIpc(): void` — 由 Task 3 提供并接入 index.ts

- [ ] **Step 1: 写失败测试**

`tests/main/security.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { createWebPreferences, buildCsp } from '../../src/main/security'

describe('security', () => {
  it('webPreferences 强制开启隔离、关闭 Node 集成', () => {
    const prefs = createWebPreferences()
    expect(prefs.contextIsolation).toBe(true)
    expect(prefs.nodeIntegration).toBe(false)
  })

  it('CSP 禁止远程脚本与远程连接', () => {
    const csp = buildCsp()
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("connect-src 'self'")
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- tests/main/security.test.ts
```

预期：FAIL，找不到 `src/main/security` 模块。

- [ ] **Step 3: 实现 security.ts**

`src/main/security.ts`：

```ts
import { join } from 'node:path'
import type { WebPreferences } from 'electron'

export function createWebPreferences(): WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: false,
    contextIsolation: true,
    nodeIntegration: false
  }
}

export function buildCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'"
  ].join('; ')
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- tests/main/security.test.ts
```

预期：PASS。

- [ ] **Step 5: 接入主进程**

修改 `src/main/index.ts` 为：

```ts
import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { createWebPreferences, buildCsp } from './security'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: createWebPreferences()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function focusMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.focus()
}

function applyCsp(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildCsp()]
      }
    })
  })
}

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => focusMainWindow())

  app.whenReady().then(() => {
    if (app.isPackaged) applyCsp()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
```

说明：CSP 只在 `app.isPackaged`（生产构建）时注入，开发环境 HMR 需要内联脚本与 WebSocket，不注入。

- [ ] **Step 6: 验证**

```bash
npm run typecheck
npm test
npm run build
```

预期：全部通过。

- [ ] **Step 7: Commit**

```bash
git add src/main/security.ts src/main/index.ts tests/main/security.test.ts
git commit -m "feat: 落实渲染进程安全基线（隔离/CSP/单实例）"
```

---

### Task 3: IPC 契约层与 Preload API

**Files:**
- Create: `src/shared/ipc/channels.ts`, `src/shared/ipc/validate.ts`, `src/shared/ipc/api.ts`, `src/main/ipc/register.ts`
- Create: `tests/shared/ipc/validate.test.ts`
- Modify: `src/preload/index.ts`（暴露 `window.api`）、`src/main/index.ts`（注册 IPC）
- Create: `src/renderer/src/env.d.ts`（`window.api` 类型）

**Interfaces:**
- Consumes: 无
- Produces:
  - `CHANNELS = { ping: 'app:ping', getVersion: 'app:get-version' }`
  - `pingResultSchema` / `versionResultSchema`（zod）
  - `type VersionInfo = { version: string; electron: string; platform: string }`
  - `validate<T>(schema: z.ZodType<T>, value: unknown): T` — 校验失败抛错
  - `interface RendererApi { ping(): Promise<{ ok: boolean }>; getVersion(): Promise<VersionInfo> }`
  - `registerIpc(): void` — 注册 `app:ping`、`app:get-version` 两个 handler

- [ ] **Step 1: 写失败测试**

`tests/shared/ipc/validate.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { validate } from '../../src/shared/ipc/validate'
import { versionResultSchema, pingResultSchema } from '../../src/shared/ipc/channels'

describe('IPC 契约校验', () => {
  it('合法的版本信息通过校验', () => {
    const info = { version: '0.1.0', electron: '36.0.0', platform: 'win32' }
    expect(validate(versionResultSchema, info)).toEqual(info)
  })

  it('缺少字段被拒绝', () => {
    expect(() => validate(versionResultSchema, { version: '0.1.0' })).toThrow()
  })

  it('ping 结果必须是布尔 ok', () => {
    expect(validate(pingResultSchema, { ok: true })).toEqual({ ok: true })
    expect(() => validate(pingResultSchema, { ok: 'yes' })).toThrow()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- tests/shared/ipc/validate.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 shared 契约**

`src/shared/ipc/channels.ts`：

```ts
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
```

`src/shared/ipc/validate.ts`：

```ts
import { z } from 'zod'

export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new Error(`IPC 数据校验失败: ${result.error.message}`)
  }
  return result.data
}
```

`src/shared/ipc/api.ts`：

```ts
import type { VersionInfo } from './channels'

export interface RendererApi {
  ping(): Promise<{ ok: boolean }>
  getVersion(): Promise<VersionInfo>
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- tests/shared/ipc/validate.test.ts
```

预期：PASS。

- [ ] **Step 5: 实现主进程 handler 注册**

`src/main/ipc/register.ts`：

```ts
import { app, ipcMain } from 'electron'
import { CHANNELS, pingResultSchema, versionResultSchema } from '@shared/ipc/channels'
import { validate } from '@shared/ipc/validate'

export function registerIpc(): void {
  ipcMain.handle(CHANNELS.ping, () => {
    return validate(pingResultSchema, { ok: true })
  })

  ipcMain.handle(CHANNELS.getVersion, () => {
    return validate(versionResultSchema, {
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      platform: process.platform
    })
  })
}
```

- [ ] **Step 6: 在 preload 暴露白名单 API**

`src/preload/index.ts`：

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '@shared/ipc/channels'
import type { RendererApi } from '@shared/ipc/api'

const api: RendererApi = {
  ping: () => ipcRenderer.invoke(CHANNELS.ping) as Promise<{ ok: boolean }>,
  getVersion: () => ipcRenderer.invoke(CHANNELS.getVersion)
}

contextBridge.exposeInMainWorld('api', api)
```

`src/renderer/src/env.d.ts`：

```ts
import type { RendererApi } from '@shared/ipc/api'

declare global {
  interface Window {
    api: RendererApi
  }
}

export {}
```

- [ ] **Step 7: 主进程启动时注册**

修改 `src/main/index.ts` 的 `app.whenReady()` 块，在 `createWindow()` 前加一行：

```ts
import { registerIpc } from './ipc/register'

// 在 whenReady().then() 内、createWindow() 之前：
registerIpc()
```

- [ ] **Step 8: 验证**

```bash
npm run typecheck
npm test
npm run build
```

预期：全部通过。

- [ ] **Step 9: Commit**

```bash
git add src/shared/ipc src/main/ipc src/preload/index.ts src/renderer/src/env.d.ts src/main/index.ts tests/shared/ipc
git commit -m "feat: 建立类型化 IPC 契约与 preload API"
```

---

### Task 4: 渲染进程骨架（Pinia + Router + 首页）

**Files:**
- Modify: `src/renderer/src/main.ts`（装配 Pinia 与 Router）
- Create: `src/renderer/src/router.ts`, `src/renderer/src/App.vue`（重写）, `src/renderer/src/views/HomeView.vue`, `src/renderer/src/stores/app.ts`
- Create: `tests/renderer/home-view.test.ts`

**Interfaces:**
- Consumes: `window.api.getVersion(): Promise<VersionInfo>`（Task 3）
- Produces:
  - `router`（hash 模式，`/` → HomeView）
  - `useAppStore()` — state `{ version: string }`，action `loadVersion(): Promise<void>`

- [ ] **Step 1: 写失败组件测试**

`tests/renderer/home-view.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia } from 'pinia'
import HomeView from '../../src/renderer/src/views/HomeView.vue'
import type { RendererApi } from '../../src/shared/ipc/api'

beforeEach(() => {
  window.api = {
    ping: vi.fn().mockResolvedValue({ ok: true }),
    getVersion: vi.fn().mockResolvedValue({
      version: '0.1.0',
      electron: '36.0.0',
      platform: 'win32'
    })
  } as unknown as RendererApi
})

describe('HomeView', () => {
  it('显示从主进程获取的应用版本', async () => {
    const wrapper = mount(HomeView, {
      global: { plugins: [createPinia()] }
    })
    await flushPromises()
    expect(wrapper.text()).toContain('0.1.0')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- tests/renderer/home-view.test.ts
```

预期：FAIL，`HomeView` 模块不存在。

- [ ] **Step 3: 实现路由、store 与页面**

`src/renderer/src/router.ts`：

```ts
import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [{ path: '/', component: HomeView }]
})
```

`src/renderer/src/stores/app.ts`：

```ts
import { defineStore } from 'pinia'

export const useAppStore = defineStore('app', {
  state: () => ({
    version: '' as string
  }),
  actions: {
    async loadVersion(): Promise<void> {
      this.version = (await window.api.getVersion()).version
    }
  }
})
```

`src/renderer/src/views/HomeView.vue`：

```vue
<script setup lang="ts">
import { onMounted } from 'vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
onMounted(() => store.loadVersion())
</script>

<template>
  <main>
    <h1>Code Reader Client</h1>
    <p>应用版本：{{ store.version || '加载中…' }}</p>
  </main>
</template>
```

重写 `src/renderer/src/App.vue`：

```vue
<template>
  <RouterView />
</template>
```

修改 `src/renderer/src/main.ts`：

```ts
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

createApp(App).use(createPinia()).use(router).mount('#app')
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- tests/renderer/home-view.test.ts
```

预期：PASS。

- [ ] **Step 5: 验证全量**

```bash
npm run typecheck
npm test
npm run build
```

预期：全部通过。

- [ ] **Step 6: Commit**

```bash
git add src/renderer tests/renderer
git commit -m "feat: 渲染进程骨架（Pinia/Router/首页版本展示）"
```

---

### Task 5: 开发文档与全量验证

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: 前四个 Task 的全部产物
- Produces: 可执行的开发/构建/测试说明

- [ ] **Step 1: 写 README**

`README.md`：

```markdown
# Code Reader Client

Vue 3 桌面客户端（Electron），CS 架构：RESTful 与外部服务端交互，C SDK 本地执行，SQLCipher 加密配置库。

## 环境要求

- Node.js >= 22.12

## 开发

```bash
npm install
npm run dev
```

## 构建与类型检查

```bash
npm run typecheck
npm run build
```

## 测试

```bash
npm test
```

## 目录结构

- `src/main` — 主进程（窗口、安全、后续的 SDK/DB/HTTP 服务）
- `src/preload` — contextBridge 白名单 API
- `src/renderer` — Vue 3 前端
- `src/shared` — 主/渲染共享的 IPC 契约与校验
- `tests` — Vitest 测试
```

- [ ] **Step 2: 全量验证**

```bash
npm run typecheck
npm test
npm run build
```

预期：全部通过，无报错。

- [ ] **Step 3: 手动冒烟（可选）**

```bash
npm run dev
```

预期：窗口显示 “Code Reader Client / 应用版本：0.1.0”。

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: 补充开发与构建说明"
```

---

## 自检记录

- 范围：本子计划仅覆盖脚手架、安全基线、IPC 契约、渲染进程骨架与文档；SDK/DB/HTTP/打包在子计划 2-6，符合单计划“独立可运行”的要求。
- 类型一致性：`RendererApi.getVersion()` 返回 `Promise<VersionInfo>` 在 preload、store、组件测试三处一致；`CHANNELS` 命名在主/预加载/共享三侧一致。
- 无占位符：所有代码块完整可执行；Task 2 Step 5 中 “预留调用点” 已明确由 Task 3 Step 7 落地，无悬空引用。
