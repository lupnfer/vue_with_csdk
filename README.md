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
