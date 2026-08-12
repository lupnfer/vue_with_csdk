构建一个 **Vue 3 桌面客户端**,采用 **CS(客户端/服务端)架构**:

- 主体通信走 **RESTful**(HTTPS)与外部服务端交互。
- 部分功能通过集成 **C SDK** 实现,且 C SDK 在**客户端本地**执行(纯浏览器无法加载 C 库,故客户端须为桌面应用)。
- C SDK 接口复杂(结构体嵌套、回调、异步、手动内存管理、内部多线程)。
- 客户端需要支持数据库，去记录一部分client的配置，且支持加密

---

## 框架选型对比（2026-08-11 归档）

**结论：采用 Electron + Vue 3。**

决策依据：团队熟悉 Node.js，Rust 能力一般；C SDK 仅提供 C 接口（DLL/静态库 + 头文件，无语言封装），接口复杂（结构体嵌套、回调、异步、手动内存管理、内部多线程），Node 侧接入路径最成熟（Koffi 纯 JS FFI 可直接对接 C 接口）；企业内部分发、无自动更新场景下，Electron 的体积/内存劣势不构成问题。

| 维度 | 方案 1：Electron + Vue 3 | 方案 2：Tauri 2 + Vue 3 |
|---|---|---|
| C SDK 接入 | 路径多且成熟：Koffi / ffi-rs 直接调 DLL；复杂接口用 N-API (C++) addon 包一层 | 必须写 Rust FFI（bindgen + unsafe）；复杂结构体、回调、异步桥接要手写胶水代码 |
| 回调 / 异步 / 多线程 | worker_threads + libuv 天然支持，JS 侧只管结果，心智模型简单 | C 回调进 Rust 需要跨线程桥接（Channel / Arc<Mutex>），再通过 IPC 发给前端，链路更长、更容易出错 |
| 内存管理 | JS/GC 兜底，C 侧手动内存由封装层负责，出问题影响面可控 | Rust 所有权模型和 C 的 manual memory 语义冲突，unsafe 块容易成为风险集中地 |
| 体积与性能 | 安装包约 150MB+，内存占用偏高 | 安装包约 10-30MB，内存低、启动快 |
| 渲染一致性 | 自带 Chromium，版本可控、无外部依赖 | 依赖系统 WebView2（Win10/11 一般自带，但企业精简镜像/老系统可能缺，需捆绑 runtime） |
| 数据库加密 | better-sqlite3 + SQLCipher 组合非常成熟；密钥可交给系统 DPAPI | rusqlite + SQLCipher 也可行，但配置和密钥管理（stronghold）要多花时间 |
| 生态与招人 | 桌面端最成熟，文档、踩坑案例最多，Node 开发者上手快 | 生态增长快，但 Rust 开发者门槛高，招人和交接成本需要考虑 |
| 分发安装 | electron-builder 一键出 NSIS，成熟稳定 | 内置 NSIS/WiX，也够用 |

**备选方案 3（不推荐首选）**：WebView2 + .NET 宿主 + Vue 3，适合有 C# 背景且有现成 C# 封装的情况，生态和社区较弱。
