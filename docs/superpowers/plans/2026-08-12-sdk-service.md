# sdk-service 架构验证 POC 实施计划（子计划 2/6）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一个自写的 mock C 库验证 sdk-service 端到端架构（Koffi FFI + worker_threads + transport 抽象 + 回调线程编组），跑通"初始化 → 打开 → 异步回调事件 → 释放"一条路径并经 IPC 暴露到渲染进程。

**Architecture:** worker_threads 优先 + transport 抽象（方案 A）。C 句柄指针不跨进程序列化——worker 内维护 `id ↔ 指针` 注册表，主进程/渲染只见 id。`Transport.invoke` 是唯一调用入口，将来切 `utilityProcess` 仅换 transport 实现。C 库内部 pthread 触发的回调经 worker 编组后 `MessagePort` 投递到主进程 `EventEmitter` → IPC → 渲染。

**Tech Stack:** Koffi 3.x（纯 TS FFI）、Node `worker_threads`/`MessagePort`、C（pthread，clang 编译）、electron-vite（worker 作为 main 构建额外入口）、zod（IPC 契约）、Vitest（单测 + 集成）。

## Global Constraints

- Koffi API 以 3.1.4 的 `index.d.ts` 为准（`koffi.load/struct/proto/pointer/opaque/register/unregister`、`lib.func(definitionString)`、`koffi.Decode.string`）。
- 目标平台 Windows，但 POC 在 macOS 开发机验证（`clang` 来自 Xcode CLT）。Windows `.dll` 交叉编译放到打包子计划。
- mock C 库产物路径：优先 `process.env.CRC_MOCK_SDK_PATH`，回退 `mock-sdk/build/libcrc_sdk.<ext>`。
- TypeScript `strict: true`；IPC 契约只定义在 `src/shared/`。
- `Transport.invoke(method, args)` 的 `method` 是 worker 内部短名（`init`/`open`/`start`/`release`/`close`/`version`），与 IPC 通道名（`sdk:init` 等）是两套命名，不必相同。
- 提交信息用 Conventional Commits。
- 单测（`npm test`）不依赖构建产物；集成测试（`npm run test:integration`）前置 `build:mock` + `npm run build`。

---

## 文件结构（本子计划创建/修改）

- `mock-sdk/c/crc_sdk.h` / `crc_sdk.c` / `Makefile` — mock C 库
- `mock-sdk/build/` — 编译产物（gitignored）
- `src/main/sdk-service/errors.ts` — `SdkError` 与码值翻译
- `src/main/sdk-service/types.ts` — 对外 TS 接口（Session/Handle/事件，无 C 指针）
- `src/main/sdk-service/binding.ts` — Koffi 声明
- `src/main/sdk-service/transport/types.ts` — Transport 接口 + 消息协议类型
- `src/main/sdk-service/transport/worker-transport.ts` — 默认 transport 实现
- `src/main/sdk-service/workers/sdk.worker.ts` — worker 入口
- `src/main/sdk-service/sdk-client.ts` — Promise facade + EventEmitter
- `src/main/ipc/register.ts`（修改） — 注册 sdk handler
- `src/shared/ipc/channels.ts`（修改） — sdk 通道 + zod schema
- `src/shared/ipc/api.ts`（修改） — `RendererApi.sdk`
- `src/preload/index.ts`（修改） — 暴露 `window.api.sdk`
- `src/renderer/src/views/SdkView.vue` + `src/renderer/src/router.ts`（修改） — 验证页
- `tests/sdk/*.test.ts` — 集成测试
- `tests/main/errors.test.ts`、`tests/shared/ipc/sdk-contract.test.ts` — 单测
- `vitest.config.ts`（修改） — 排除 `tests/sdk/**` 与 `.worktrees/**`
- `vitest.config.integration.ts` — 集成测试配置
- `electron.vite.config.ts`（修改） — worker 构建入口
- `package.json`（修改） — 加 koffi、`build:mock`、`test:integration`、`test:all`

---

### Task 1: mock C 库与构建

**Files:**
- Create: `mock-sdk/c/crc_sdk.h`, `mock-sdk/c/crc_sdk.c`, `mock-sdk/c/Makefile`
- Modify: `package.json`（加 koffi 依赖、`build:mock` 脚本）
- Create: `tests/sdk/load.test.ts`（集成测试，加载与版本）

**Interfaces:**
- Consumes: 无
- Produces: `npm run build:mock` 产出 `mock-sdk/build/libcrc_sdk.<ext>`；6 个 C 函数可被 Koffi 加载调用。

- [ ] **Step 1: 安装 Koffi**

```bash
npm install koffi
```

预期：`package.json` 的 `dependencies` 出现 `koffi`，生成 `package-lock.json`。

- [ ] **Step 2: 创建 mock C 头文件**

`mock-sdk/c/crc_sdk.h`：

```c
#ifndef CRC_SDK_H
#define CRC_SDK_H

#ifdef __cplusplus
extern "C" {
#endif

/* 嵌套结构体（验证结构体映射） */
typedef struct {
    int level;
    const char *prefix;
} logger_config;

typedef struct {
    int mode;
    logger_config logger;   /* 嵌套 */
} sdk_config;

/* 不透明句柄 */
typedef struct sdk_session sdk_session;
typedef struct sdk_handle   sdk_handle;

/* 回调原型（验证回调注册 + 线程编组） */
typedef void (*scan_callback)(int event_type, const char *payload, void *user_data);

typedef struct {
    scan_callback cb;
    void *user_data;
} open_params;

sdk_session* crc_sdk_init(const sdk_config *config);
sdk_handle*  crc_sdk_open(sdk_session *session, const open_params *params);
int          crc_sdk_start_scan(sdk_handle *handle);
int          crc_sdk_release(sdk_handle *handle);
int          crc_sdk_close(sdk_session *session);
const char*  crc_sdk_version(void);

#ifdef __cplusplus
}
#endif
#endif
```

- [ ] **Step 3: 创建 mock C 实现**

`mock-sdk/c/crc_sdk.c`：

```c
#include "crc_sdk.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <pthread.h>
#include <unistd.h>

struct sdk_session {
    int mode;
    int closed;
};

struct sdk_handle {
    sdk_session *session;
    scan_callback cb;
    void *user_data;
    int released;
};

static const char *g_version = "crc-mock-1.0.0";

const char* crc_sdk_version(void) {
    return g_version;
}

sdk_session* crc_sdk_init(const sdk_config *config) {
    if (config == NULL || config->mode < 0) {
        return NULL;   /* 校验失败 */
    }
    sdk_session *s = (sdk_session*)malloc(sizeof(sdk_session));
    if (s == NULL) return NULL;
    s->mode = config->mode;
    s->closed = 0;
    return s;
}

sdk_handle* crc_sdk_open(sdk_session *session, const open_params *params) {
    if (session == NULL || session->closed || params == NULL || params->cb == NULL) {
        return NULL;
    }
    sdk_handle *h = (sdk_handle*)malloc(sizeof(sdk_handle));
    if (h == NULL) return NULL;
    h->session = session;
    h->cb = params->cb;
    h->user_data = params->user_data;
    h->released = 0;
    return h;
}

typedef struct {
    scan_callback cb;
    void *user_data;
    unsigned long ctid;
} scan_thread_arg;

static void* scan_thread_main(void *arg) {
    scan_thread_arg *a = (scan_thread_arg*)arg;
    char buf[128];
    /* 在 C 内部线程上异步投递两个事件 */
    usleep(20 * 1000);   /* 20ms */
    snprintf(buf, sizeof(buf), "{\"status\":\"started\",\"ctid\":%lu}", a->ctid);
    a->cb(1, buf, a->user_data);
    usleep(30 * 1000);   /* 30ms */
    snprintf(buf, sizeof(buf), "{\"status\":\"done\",\"items\":3,\"ctid\":%lu}", a->ctid);
    a->cb(2, buf, a->user_data);
    free(a);
    return NULL;
}

int crc_sdk_start_scan(sdk_handle *handle) {
    if (handle == NULL || handle->released) {
        return -1;
    }
    scan_thread_arg *arg = (scan_thread_arg*)malloc(sizeof(scan_thread_arg));
    if (arg == NULL) return -2;
    arg->cb = handle->cb;
    arg->user_data = handle->user_data;
    arg->ctid = (unsigned long)pthread_self();

    pthread_t tid;
    pthread_attr_t attr;
    pthread_attr_init(&attr);
    pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
    int rc = pthread_create(&tid, &attr, scan_thread_main, arg);
    pthread_attr_destroy(&attr);
    if (rc != 0) {
        free(arg);
        return rc;
    }
    return 0;   /* 立即返回，结果走回调（异步） */
}

int crc_sdk_release(sdk_handle *handle) {
    if (handle == NULL) return -1;
    if (handle->released) return -3;   /* 重复释放 */
    handle->released = 1;
    handle->cb = NULL;                 /* 取消回调 */
    free(handle);
    return 0;
}

int crc_sdk_close(sdk_session *session) {
    if (session == NULL) return -1;
    if (session->closed) return -3;
    session->closed = 1;
    free(session);
    return 0;
}
```

- [ ] **Step 4: 创建 Makefile**

`mock-sdk/c/Makefile`：

```makefile
CC ?= clang
UNAME := $(shell uname -s)
ifeq ($(UNAME),Darwin)
  LIB_EXT := dylib
else
  LIB_EXT := so
endif

BUILD_DIR := ../build
TARGET := $(BUILD_DIR)/libcrc_sdk.$(LIB_EXT)

.PHONY: all clean
all: $(TARGET)

$(TARGET): crc_sdk.c crc_sdk.h
	@mkdir -p $(BUILD_DIR)
	$(CC) -shared -fPIC -Wall -o $(TARGET) crc_sdk.c -lpthread

clean:
	rm -f $(TARGET)
```

- [ ] **Step 5: 创建 .gitignore 忽略产物**

在仓库根 `.gitignore` 追加（如未有）：

```
# Mock SDK build output
mock-sdk/build/
```

- [ ] **Step 6: 加 build:mock 脚本**

修改 `package.json` 的 `scripts`，加：

```json
"build:mock": "make -C mock-sdk/c"
```

- [ ] **Step 7: 编译 mock 库**

```bash
npm run build:mock
```

预期：`mock-sdk/build/libcrc_sdk.dylib` 存在（macOS）。

- [ ] **Step 8: 写加载冒烟测试**

创建集成测试配置 `vitest.config.integration.ts`（先于测试文件）：

```ts
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
```

`tests/sdk/load.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import koffi from 'koffi'
import { join } from 'node:path'
import { platform } from 'node:os'

const ext = platform() === 'darwin' ? 'dylib' : platform() === 'win32' ? 'dll' : 'so'
const libPath = process.env['CRC_MOCK_SDK_PATH'] ?? join(process.cwd(), `mock-sdk/build/libcrc_sdk.${ext}`)

describe('mock SDK 加载', () => {
  it('能加载库并读取版本号', () => {
    const lib = koffi.load(libPath)
    const version = lib.func('const char *crc_sdk_version(void)')
    expect(version()).toBe('crc-mock-1.0.0')
  })
})
```

- [ ] **Step 9: 运行集成测试确认通过**

```bash
npm run build:mock && npx vitest run --config vitest.config.integration.ts tests/sdk/load.test.ts
```

预期：PASS。若报找不到库，确认 `npm run build:mock` 成功且路径正确。

- [ ] **Step 10: Commit**

```bash
git add mock-sdk package.json package-lock.json .gitignore vitest.config.integration.ts tests/sdk/load.test.ts
git commit -m "feat(sdk): mock C 库与构建脚本"
```

---

### Task 2: errors.ts 与 types.ts（纯 TS，TDD）

**Files:**
- Create: `src/main/sdk-service/errors.ts`, `src/main/sdk-service/types.ts`
- Create: `tests/main/errors.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `SdkError` 类、`translateError(code, category, message)` 翻译函数、`Session`/`Handle`/`SdkEvent` 类型。

- [ ] **Step 1: 写失败测试**

`tests/main/errors.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { SdkError, translateError } from '../../src/main/sdk-service/errors'

describe('SdkError', () => {
  it('translateError 把 C 错误码翻译成类型化错误', () => {
    const err = translateError({ code: -1, category: 'call', raw: 'bad handle' })
    expect(err).toBeInstanceOf(SdkError)
    expect(err.code).toBe('SDK_CALL_FAILED')
    expect(err.category).toBe('call')
    expect(err.retryable).toBe(false)
  })

  it('重复释放有专门码值', () => {
    const err = translateError({ code: -3, category: 'memory', raw: 'double release' })
    expect(err.code).toBe('SDK_ALREADY_RELEASED')
    expect(err.retryable).toBe(false)
  })

  it('未知码值落入 unknown 且可重试', () => {
    const err = translateError({ code: -999, category: 'unknown', raw: '?' })
    expect(err.code).toBe('SDK_UNKNOWN')
    expect(err.category).toBe('unknown')
    expect(err.retryable).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run tests/main/errors.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 errors.ts**

`src/main/sdk-service/errors.ts`：

```ts
export type SdkErrorCategory = 'init' | 'call' | 'callback' | 'memory' | 'unknown'

export interface RawError {
  code: number
  category: SdkErrorCategory
  raw: string
}

export class SdkError extends Error {
  readonly code: string
  readonly category: SdkErrorCategory
  readonly retryable: boolean

  constructor(code: string, category: SdkErrorCategory, message: string, retryable: boolean) {
    super(message)
    this.name = 'SdkError'
    this.code = code
    this.category = category
    this.retryable = retryable
  }
}

interface Rule {
  code: string
  retryable: boolean
}

const RULES: Record<number, Rule> = {
  [-1]: { code: 'SDK_CALL_FAILED', retryable: false },
  [-2]: { code: 'SDK_OOM', retryable: true },
  [-3]: { code: 'SDK_ALREADY_RELEASED', retryable: false }
}

export function translateError(raw: RawError): SdkError {
  const rule = RULES[raw.code] ?? { code: 'SDK_UNKNOWN', retryable: true }
  const message = `[${raw.category}] ${rule.code}: ${raw.raw} (code=${raw.code})`
  return new SdkError(rule.code, raw.category, message, rule.retryable)
}

/** 序列化形式（跨 worker MessagePort 传输） */
export interface SerializedError {
  code: string
  category: SdkErrorCategory
  message: string
  retryable: boolean
}

export function serializeError(err: SdkError): SerializedError {
  return { code: err.code, category: err.category, message: err.message, retryable: err.retryable }
}

export function deserializeError(data: SerializedError): SdkError {
  return new SdkError(data.code, data.category, data.message, data.retryable)
}
```

- [ ] **Step 4: 实现 types.ts**

`src/main/sdk-service/types.ts`：

```ts
/** 对外句柄：不透明 id，不含 C 指针 */
export interface Session {
  id: number
}

export interface Handle {
  id: number
}

export interface SdkConfig {
  mode: number
  logger: { level: number; prefix: string }
}

export interface SdkEvent {
  handleId: number
  eventType: number
  payload: string
}
```

- [ ] **Step 5: 运行确认通过**

```bash
npx vitest run tests/main/errors.test.ts
```

预期：PASS。

- [ ] **Step 6: Commit**

```bash
git add src/main/sdk-service/errors.ts src/main/sdk-service/types.ts tests/main/errors.test.ts
git commit -m "feat(sdk): SdkError 翻译与对外类型"
```

---

### Task 3: binding.ts（Koffi 声明）

**Files:**
- Create: `src/main/sdk-service/binding.ts`
- Create: `tests/sdk/binding.test.ts`

**Interfaces:**
- Consumes: mock C 库、Koffi
- Produces: `lib`、6 个 Koffi 函数声明、`ScanCallback` proto、struct 类型。

- [ ] **Step 1: 写失败测试**

`tests/sdk/binding.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  crcVersion,
  crcInit,
  crcOpen,
  crcRelease,
  crcClose,
  registerCallback
} from '../../src/main/sdk-service/binding'
import type { SdkConfigStruct, OpenParamsStruct } from '../../src/main/sdk-service/binding'

describe('binding', () => {
  it('声明加载成功并读取版本', () => {
    expect(crcVersion()).toBe('crc-mock-1.0.0')
  })

  it('init 非法 config 返回 NULL 指针', () => {
    const ptr = crcInit({ mode: -1, logger: { level: 0, prefix: 'x' } } as unknown as SdkConfigStruct)
    expect(ptr).toBeNull()
  })

  it('完整生命周期：init → open → release → close', () => {
    const session = crcInit({ mode: 1, logger: { level: 2, prefix: 't' } } as unknown as SdkConfigStruct)
    expect(session).not.toBeNull()
    // 注册空回调让 open 成功（C 侧拒绝 cb=NULL）；异步回调路径在 Task 5 验证
    const cb = (): void => {}
    registerCallback(cb)
    const handle = crcOpen(session!, { cb, user_data: null } as unknown as OpenParamsStruct)
    expect(handle).not.toBeNull()
    expect(crcRelease(handle!)).toBe(0)
    expect(crcClose(session!)).toBe(0)
  })
})
```

> 说明：此测试注册空回调让 `open` 成功，验证结构体传递与同步生命周期（init/open/release/close）；异步回调与线程编组在 Task 5 验证，故此处不调 `startScan` 以避免 detached 线程竞态。

- [ ] **Step 2: 运行确认失败**

```bash
npm run build:mock && npx vitest run --config vitest.config.integration.ts tests/sdk/binding.test.ts
```

预期：FAIL，模块不存在。

- [ ] **Step 3: 实现 binding.ts**

`src/main/sdk-service/binding.ts`：

```ts
import koffi from 'koffi'
import { join } from 'node:path'
import { platform } from 'node:os'

const ext = platform() === 'win32' ? 'dll' : platform() === 'darwin' ? 'dylib' : 'so'
const libPath = process.env['CRC_MOCK_SDK_PATH'] ?? join(process.cwd(), `mock-sdk/build/libcrc_sdk.${ext}`)

export const lib = koffi.load(libPath)

// 不透明句柄类型（typedef struct sdk_session sdk_session;）
export const SessionType = koffi.opaque('sdk_session')
export const HandleType = koffi.opaque('sdk_handle')

// 嵌套结构体
export const LoggerConfigStruct = koffi.struct('logger_config', {
  level: 'int',
  prefix: 'string'   // const char *
})

export const SdkConfigStruct = koffi.struct('sdk_config', {
  mode: 'int',
  logger: LoggerConfigStruct   // 嵌套
})

// 回调原型
export const ScanCallback = koffi.proto('void scan_callback(int event_type, const char *payload, void *user_data)')

// open_params
export const OpenParamsStruct = koffi.struct('open_params', {
  cb: koffi.pointer(ScanCallback),
  user_data: 'void *'
})

// 函数声明
export const crcInit = lib.func('sdk_session *crc_sdk_init(sdk_config *config)')
export const crcOpen = lib.func('sdk_handle *crc_sdk_open(sdk_session *session, open_params *params)')
export const crcStartScan = lib.func('int crc_sdk_start_scan(sdk_handle *handle)')
export const crcRelease = lib.func('int crc_sdk_release(sdk_handle *handle)')
export const crcClose = lib.func('int crc_sdk_close(sdk_session *session)')
export const crcVersion = lib.func('const char *crc_sdk_version(void)')

/** 在 worker 内注册 JS 回调，返回注册 id（用于 unregister）。
 *  注意：koffi.register 要求传入函数指针类型（Callback），不是 proto 本身（Prototype）；
 *  计划初稿写成 koffi.register(fn, ScanCallback) 会在运行时抛
 *  "Unexpected scan_callback type, expected <callback> * type"，故用 koffi.pointer(ScanCallback)。 */
export function registerCallback(fn: (eventType: number, payload: string, userData: unknown) => void): bigint {
  return koffi.register(fn, koffi.pointer(ScanCallback))
}

export function unregisterCallback(id: bigint): void {
  koffi.unregister(id)
}
```

> 命名导出 `SdkConfigStruct`/`OpenParamsStruct` 同时作为类型（Koffi TypeObject）与构造值用；测试里 `as unknown as SdkConfigStruct` 仅借其类型名做占位，实际传普通 JS 对象，Koffi 会按 struct 定义编解码。

- [ ] **Step 4: 运行确认通过**

```bash
npm run build:mock && npx vitest run --config vitest.config.integration.ts tests/sdk/binding.test.ts
```

预期：PASS。若 `crcInit` 报类型不匹配，检查 struct 字段名与 C 头一致。

- [ ] **Step 5: Commit**

```bash
git add src/main/sdk-service/binding.ts tests/sdk/binding.test.ts
git commit -m "feat(sdk): Koffi binding 声明（结构体/回调/句柄）"
```

---

### Task 4: transport 接口与 worker 骨架（生命周期）

**Files:**
- Create: `src/main/sdk-service/transport/types.ts`, `src/main/sdk-service/transport/worker-transport.ts`
- Create: `src/main/sdk-service/workers/sdk.worker.ts`
- Modify: `electron.vite.config.ts`（worker 构建入口）
- Create: `tests/sdk/lifecycle.test.ts`

**Interfaces:**
- Consumes: `binding.ts`、`errors.ts`
- Produces: `Transport` 接口、`WorkerTransport` 类、`sdk.worker.ts` 处理 `init`/`open`/`release`/`close`/`version`。

- [ ] **Step 1: 实现 transport 消息协议类型**

`src/main/sdk-service/transport/types.ts`：

```ts
import type { SerializedError } from '../errors'

/** 主进程 → worker */
export interface InvokeMessage {
  type: 'invoke'
  id: number
  method: string
  args: unknown[]
}

/** worker → 主进程：调用结果 */
export type ResultMessage =
  | { type: 'result'; id: number; ok: true; data: unknown }
  | { type: 'result'; id: number; ok: false; error: SerializedError }

/** worker → 主进程：异步事件 */
export interface EventMessage {
  type: 'event'
  data: unknown
}

export type WorkerInbound = InvokeMessage
export type WorkerOutbound = ResultMessage | EventMessage
```

- [ ] **Step 2: 实现 worker 入口**

`src/main/sdk-service/workers/sdk.worker.ts`：

```ts
import { parentPort } from 'node:worker_threads'
import {
  crcInit,
  crcOpen,
  crcRelease,
  crcClose,
  crcVersion,
  registerCallback,
  unregisterCallback
} from '../binding'
import type { InvokeMessage, ResultMessage, EventMessage } from '../transport/types'
import type { SerializedError } from '../errors'

// id ↔ 指针 注册表（指针只在 worker 内持有与释放）
const sessions = new Map<number, unknown>()     // id → session ptr
const handles = new Map<number, unknown>()      // id → handle ptr
const handleCallbacks = new Map<number, bigint>() // handle id → koffi 注册 id
let nextId = 1

function allocId(): number {
  return nextId++
}

function post(msg: ResultMessage | EventMessage): void {
  parentPort?.postMessage(msg)
}

function ok(id: number, data: unknown): void {
  post({ type: 'result', id, ok: true, data })
}

function fail(id: number, error: SerializedError): void {
  post({ type: 'result', id, ok: false, error })
}

parentPort?.on('message', (msg: InvokeMessage) => {
  try {
    switch (msg.method) {
      case 'version': {
        ok(msg.id, crcVersion())
        break
      }
      case 'init': {
        const [config] = msg.args as [{ mode: number; logger: { level: number; prefix: string } }]
        const ptr = crcInit(config)
        if (!ptr) {
          fail(msg.id, { code: 'SDK_INIT_FAILED', category: 'init', message: 'init returned NULL', retryable: false })
          return
        }
        const id = allocId()
        sessions.set(id, ptr)
        ok(msg.id, { id })
        break
      }
      case 'open': {
        const [sessionId] = msg.args as [number]
        const sessionPtr = sessions.get(sessionId)
        if (!sessionPtr) {
          fail(msg.id, { code: 'SDK_NO_SESSION', category: 'call', message: 'session not found', retryable: false })
          return
        }
        const handleId = allocId()
        // 注册回调：投递到主进程
        const cb = (eventType: number, payload: string, _userData: unknown): void => {
          post({ type: 'event', data: { handleId, eventType, payload } })
        }
        const regId = registerCallback(cb)
        const ptr = crcOpen(sessionPtr, { cb: regId, user_data: null })
        if (!ptr) {
          unregisterCallback(regId)
          fail(msg.id, { code: 'SDK_OPEN_FAILED', category: 'call', message: 'open returned NULL', retryable: false })
          return
        }
        handles.set(handleId, ptr)
        handleCallbacks.set(handleId, regId)
        ok(msg.id, { id: handleId })
        break
      }
      case 'release': {
        const [handleId] = msg.args as [number]
        const ptr = handles.get(handleId)
        if (!ptr) {
          fail(msg.id, { code: 'SDK_ALREADY_RELEASED', category: 'memory', message: 'handle not found', retryable: false })
          return
        }
        const rc = crcRelease(ptr) as number
        if (rc !== 0) {
          fail(msg.id, { code: 'SDK_CALL_FAILED', category: 'memory', message: `release rc=${rc}`, retryable: false })
          return
        }
        const regId = handleCallbacks.get(handleId)
        if (regId !== undefined) {
          unregisterCallback(regId)
          handleCallbacks.delete(handleId)
        }
        handles.delete(handleId)
        ok(msg.id, null)
        break
      }
      case 'close': {
        const [sessionId] = msg.args as [number]
        const ptr = sessions.get(sessionId)
        if (!ptr) {
          fail(msg.id, { code: 'SDK_ALREADY_RELEASED', category: 'memory', message: 'session not found', retryable: false })
          return
        }
        const rc = crcClose(ptr) as number
        if (rc !== 0) {
          fail(msg.id, { code: 'SDK_CALL_FAILED', category: 'memory', message: `close rc=${rc}`, retryable: false })
          return
        }
        sessions.delete(sessionId)
        ok(msg.id, null)
        break
      }
      default: {
        fail(msg.id, { code: 'SDK_UNKNOWN_METHOD', category: 'call', message: `unknown method ${msg.method}`, retryable: false })
      }
    }
  } catch (e) {
    fail(msg.id, {
      code: 'SDK_UNKNOWN',
      category: 'unknown',
      message: e instanceof Error ? e.message : String(e),
      retryable: true
    })
  }
})
```

> `registerCallback(cb)` 返回一个 registered 指针（bigint），koffi 为 `cb` 创建并持有 trampoline，直到 `unregisterCallback(regId)`。**必须把这个指针传给 `open_params.cb` 字段（`{ cb: regId, ... }`），而不是 JS 函数 `cb` 本身**——koffi 对直接传入 struct 字段的 JS 函数按 transient 回调处理（`crcOpen` 返回即失效），而 `startScan` 会在后续 pthread 上调用回调，transient 回调此时已失效会崩溃（`v8::HandleScope::CreateHandle`）。这是 koffi 文档对"延迟调用的回调"的标准模式（registered callbacks）。

- [ ] **Step 3: 实现 Transport 接口与 WorkerTransport**

`src/main/sdk-service/transport/worker-transport.ts`：

```ts
import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import type { InvokeMessage, WorkerOutbound } from './types'
import { deserializeError, type SerializedError } from '../errors'

export interface Transport {
  invoke<T>(method: string, args: unknown[]): Promise<T>
  on(event: 'data', cb: (payload: unknown) => void): void
  on(event: 'error', cb: (err: unknown) => void): void
  terminate(): void
}

export class WorkerTransport implements Transport {
  private readonly worker: Worker
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  private readonly emitter = new EventEmitter()
  private callId = 1

  constructor(workerScriptPath?: string) {
    const script = workerScriptPath ?? join(__dirname, 'workers/sdk.worker.js')
    this.worker = new Worker(script)
    this.worker.on('message', (msg: WorkerOutbound) => this.handleMessage(msg))
    this.worker.on('error', (err) => this.emitter.emit('error', err))
  }

  private handleMessage(msg: WorkerOutbound): void {
    if (msg.type === 'event') {
      this.emitter.emit('data', msg.data)
      return
    }
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.ok) {
      p.resolve(msg.data)
    } else {
      p.reject(deserializeError(msg.error as SerializedError))
    }
  }

  invoke<T>(method: string, args: unknown[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.callId++
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      const invoke: InvokeMessage = { type: 'invoke', id, method, args }
      this.worker.postMessage(invoke)
    })
  }

  on(event: 'data' | 'error', cb: (payload: unknown) => void): void {
    this.emitter.on(event, cb)
  }

  terminate(): void {
    this.worker.terminate()
  }
}
```

- [ ] **Step 4: 配置 electron-vite worker 构建入口**

修改 `electron.vite.config.ts` 的 `main` 段为：

```ts
  main: {
    resolve: {
      alias: { '@shared': resolve('src/shared') }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'workers/sdk.worker': resolve('src/main/sdk-service/workers/sdk.worker.ts')
        }
      }
    }
  },
```

> 产出 `out/main/index.js` 与 `out/main/workers/sdk.worker.js`。koffi 是 `dependencies`，被 `externalizeDeps`（默认 true）外部化，不打包进 bundle。worker 仅 `import type` 共享类型（编译期擦除），与 index 无运行时共享代码，避免代码分割问题。

- [ ] **Step 5: 写生命周期集成测试**

`tests/sdk/lifecycle.test.ts`：

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { WorkerTransport } from '../../src/main/sdk-service/transport/worker-transport'

const workerScript = join(process.cwd(), 'out/main/workers/sdk.worker.js')

describe('sdk-service 生命周期', () => {
  let transport: WorkerTransport

  afterEach(() => {
    transport?.terminate()
  })

  it('version 调用返回版本号', async () => {
    transport = new WorkerTransport(workerScript)
    const v = await transport.invoke<string>('version', [])
    expect(v).toBe('crc-mock-1.0.0')
  })

  it('init → open → release → close 全程成功', async () => {
    transport = new WorkerTransport(workerScript)
    const session = await transport.invoke<{ id: number }>('init', [{ mode: 1, logger: { level: 2, prefix: 't' } }])
    expect(session.id).toBeGreaterThan(0)
    const handle = await transport.invoke<{ id: number }>('open', [session.id])
    expect(handle.id).toBeGreaterThan(0)
    await transport.invoke('release', [handle.id])
    await transport.invoke('close', [session.id])
  })

  it('重复 release 返回已释放错误', async () => {
    transport = new WorkerTransport(workerScript)
    const session = await transport.invoke<{ id: number }>('init', [{ mode: 1, logger: { level: 0, prefix: '' } }])
    const handle = await transport.invoke<{ id: number }>('open', [session.id])
    await transport.invoke('release', [handle.id])
    await expect(transport.invoke('release', [handle.id])).rejects.toThrow(/SDK_ALREADY_RELEASED/)
    await transport.invoke('close', [session.id])
  })
})
```

- [ ] **Step 6: 构建并运行集成测试**

```bash
npm run build:mock && npm run build && npx vitest run --config vitest.config.integration.ts tests/sdk/lifecycle.test.ts
```

预期：PASS。`out/main/workers/sdk.worker.js` 存在且三个用例通过。

- [ ] **Step 7: Commit**

```bash
git add src/main/sdk-service/transport src/main/sdk-service/workers/sdk.worker.ts electron.vite.config.ts tests/sdk/lifecycle.test.ts
git commit -m "feat(sdk): transport 接口与 worker 骨架（生命周期）"
```

---

### Task 5: 异步回调与线程编组（§11 风险 #4 验证）

**Files:**
- Create: `tests/sdk/callback.test.ts`
- Modify: `src/main/sdk-service/workers/sdk.worker.ts`（加 `start` method）

**Interfaces:**
- Consumes: Task 4 的 transport
- Produces: worker 处理 `start` method；`Transport.on('data', cb)` 收到回调事件。

> **风险提示：** 这是 POC 核心验证点。mock C 库在 pthread 上调用 koffi 注册的 JS 回调，worker 内 `parentPort.postMessage` 投递到主进程。若 koffi 不能把跨线程回调安全编组到 worker 的 JS 线程，此测试会挂起或崩溃——即 POC 发现，需排查 `koffi.config()` 异步栈设置或改用 SharedArrayBuffer 轮询兜底。先按直通路径跑。

- [ ] **Step 1: 在 worker 加 start method**

修改 `src/main/sdk-service/workers/sdk.worker.ts`，在 `release` case 之前加：

```ts
      case 'start': {
        const [handleId] = msg.args as [number]
        const ptr = handles.get(handleId)
        if (!ptr) {
          fail(msg.id, { code: 'SDK_CALL_FAILED', category: 'call', message: 'handle not found', retryable: false })
          return
        }
        const rc = crcStartScan(ptr) as number
        if (rc !== 0) {
          fail(msg.id, { code: 'SDK_CALL_FAILED', category: 'call', message: `start rc=${rc}`, retryable: false })
          return
        }
        ok(msg.id, null)   // 立即返回；结果走回调事件
        break
      }
```

并在文件顶部 import 加 `crcStartScan`：

```ts
import {
  crcInit,
  crcOpen,
  crcStartScan,   // 新增
  crcRelease,
  crcClose,
  crcVersion,
  registerCallback,
  unregisterCallback
} from '../binding'
```

- [ ] **Step 2: 写回调集成测试**

`tests/sdk/callback.test.ts`：

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { WorkerTransport } from '../../src/main/sdk-service/transport/worker-transport'
import type { SdkEvent } from '../../src/main/sdk-service/types'

const workerScript = join(process.cwd(), 'out/main/workers/sdk.worker.js')

describe('sdk-service 异步回调线程编组', () => {
  let transport: WorkerTransport

  afterEach(() => {
    transport?.terminate()
  })

  it('startScan 后在超时内收到回调事件，数据正确', async () => {
    transport = new WorkerTransport(workerScript)
    const session = await transport.invoke<{ id: number }>('init', [{ mode: 1, logger: { level: 0, prefix: '' } }])
    const handle = await transport.invoke<{ id: number }>('open', [session.id])

    const events: SdkEvent[] = []
    transport.on('data', (d) => events.push(d as SdkEvent))

    await transport.invoke('start', [handle.id])

    // 等待两个回调事件（mock 投递 started + done）
    const deadline = Date.now() + 3000
    while (events.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(events.length).toBeGreaterThanOrEqual(2)
    expect(events[0].eventType).toBe(1)
    expect(events[0].payload).toContain('started')
    expect(events[1].eventType).toBe(2)
    expect(events[1].payload).toContain('done')
    expect(events.every((e) => e.handleId === handle.id)).toBe(true)

    await transport.invoke('release', [handle.id])
    await transport.invoke('close', [session.id])
  })

  it('startScan 立即返回，不阻塞 worker（回调到达后 worker 仍可响应 invoke）', async () => {
    transport = new WorkerTransport(workerScript)
    const session = await transport.invoke<{ id: number }>('init', [{ mode: 1, logger: { level: 0, prefix: '' } }])
    const handle = await transport.invoke<{ id: number }>('open', [session.id])
    transport.on('data', () => {})

    const startAt = Date.now()
    await transport.invoke('start', [handle.id])
    const startDur = Date.now() - startAt
    // start 应几乎立即返回（< 100ms），证明不阻塞
    expect(startDur).toBeLessThan(100)

    // 回调排队期间 worker 仍响应 version
    const v = await transport.invoke<string>('version', [])
    expect(v).toBe('crc-mock-1.0.0')

    // 等回调排空再释放，避免 detached 线程访问已释放句柄
    await new Promise((r) => setTimeout(r, 200))
    await transport.invoke('release', [handle.id])
    await transport.invoke('close', [session.id])
  })
})
```

> **注意：** mock 的 detached 扫描线程在 release 后仍可能回调（C 侧 `cb` 已被置 NULL，但已进入 `usleep` 的线程不会再访问 handle 内存——`scan_thread_arg` 是独立分配的，安全）。若偶发崩溃，把释放延迟到回调全部到达之后（测试已含 `setTimeout 200`）。

- [ ] **Step 3: 构建并运行**

```bash
npm run build:mock && npm run build && npx vitest run --config vitest.config.integration.ts tests/sdk/callback.test.ts
```

预期：PASS。两个用例验证回调到达 + 数据正确 + 不阻塞 worker。

> **若挂起/崩溃：** 这是 §11 #4 风险命中。排查方向：① koffi 是否需 `koffi.config({ async_stack_size: ... })`；② 改为在回调里 `Atomics.store` + `Atomics.notify` 一个 `SharedArrayBuffer`，worker 主循环轮询。记录发现并按兜底实现。

- [ ] **Step 4: Commit**

```bash
git add src/main/sdk-service/workers/sdk.worker.ts tests/sdk/callback.test.ts
git commit -m "feat(sdk): 异步回调线程编组（§11 #4 验证）"
```

---

### Task 6: 内存泄漏检测与错误传播

**Files:**
- Modify: `src/main/sdk-service/workers/sdk.worker.ts`（加 `closeAll` 泄漏扫描）
- Create: `tests/sdk/leak.test.ts`, `tests/sdk/error.test.ts`

**Interfaces:**
- Consumes: Task 4/5
- Produces: worker `closeAll` method（debug 泄漏扫描 + 日志）；错误码经 MessagePort 还原为 `SdkError`。

- [ ] **Step 1: 在 worker 加 closeAll 泄漏扫描**

修改 `src/main/sdk-service/workers/sdk.worker.ts`，在 `default` case 之前加：

```ts
      case 'closeAll': {
        const leakedHandles = [...handles.keys()]
        const leakedSessions = [...sessions.keys()]
        if (leakedHandles.length || leakedSessions.length) {
          // POC：仅打日志，不硬失败
          post({
            type: 'event',
            data: { kind: 'leak', handles: leakedHandles, sessions: leakedSessions }
          })
        }
        // 清理所有回调注册
        for (const regId of handleCallbacks.values()) unregisterCallback(regId)
        handleCallbacks.clear()
        handles.clear()
        sessions.clear()
        ok(msg.id, { handles: leakedHandles.length, sessions: leakedSessions.length })
        break
      }
```

- [ ] **Step 2: 写泄漏检测测试**

`tests/sdk/leak.test.ts`：

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { WorkerTransport } from '../../src/main/sdk-service/transport/worker-transport'

const workerScript = join(process.cwd(), 'out/main/workers/sdk.worker.js')

describe('sdk-service 内存泄漏检测', () => {
  let transport: WorkerTransport

  afterEach(() => {
    transport?.terminate()
  })

  it('全部释放后 closeAll 报告零泄漏', async () => {
    transport = new WorkerTransport(workerScript)
    const session = await transport.invoke<{ id: number }>('init', [{ mode: 1, logger: { level: 0, prefix: '' } }])
    const handle = await transport.invoke<{ id: number }>('open', [session.id])
    await transport.invoke('release', [handle.id])
    await transport.invoke('close', [session.id])

    const report = await transport.invoke<{ handles: number; sessions: number }>('closeAll', [])
    expect(report.handles).toBe(0)
    expect(report.sessions).toBe(0)
  })

  it('故意不释放时 closeAll 报告泄漏并投递 leak 事件', async () => {
    transport = new WorkerTransport(workerScript)
    const session = await transport.invoke<{ id: number }>('init', [{ mode: 1, logger: { level: 0, prefix: '' } }])
    await transport.invoke<{ id: number }>('open', [session.id])

    const events: unknown[] = []
    transport.on('data', (d) => events.push(d))

    const report = await transport.invoke<{ handles: number; sessions: number }>('closeAll', [])
    expect(report.handles).toBeGreaterThanOrEqual(1)
    expect(report.sessions).toBeGreaterThanOrEqual(1)
    expect(events.some((e) => (e as { kind: string }).kind === 'leak')).toBe(true)
  })
})
```

- [ ] **Step 3: 写错误传播测试**

`tests/sdk/error.test.ts`：

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { WorkerTransport } from '../../src/main/sdk-service/transport/worker-transport'
import { SdkError } from '../../src/main/sdk-service/errors'

const workerScript = join(process.cwd(), 'out/main/workers/sdk.worker.js')

describe('sdk-service 错误传播', () => {
  let transport: WorkerTransport

  afterEach(() => {
    transport?.terminate()
  })

  it('init 非法 config 还原为 SdkError(category=init)', async () => {
    transport = new WorkerTransport(workerScript)
    await expect(transport.invoke('init', [{ mode: -1, logger: { level: 0, prefix: '' } }])).rejects.toMatchObject({
      code: 'SDK_INIT_FAILED',
      category: 'init'
    })
  })

  it('open 不存在的 session 还原为 SdkError', async () => {
    transport = new WorkerTransport(workerScript)
    await expect(transport.invoke('open', [9999])).rejects.toBeInstanceOf(SdkError)
  })
})
```

- [ ] **Step 4: 构建并运行**

```bash
npm run build:mock && npm run build && npx vitest run --config vitest.config.integration.ts tests/sdk/leak.test.ts tests/sdk/error.test.ts
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add src/main/sdk-service/workers/sdk.worker.ts tests/sdk/leak.test.ts tests/sdk/error.test.ts
git commit -m "feat(sdk): 泄漏检测与错误传播"
```

---

### Task 7: sdk-client.ts（Promise facade + EventEmitter）

**Files:**
- Create: `src/main/sdk-service/sdk-client.ts`
- Create: `tests/sdk/client.test.ts`

**Interfaces:**
- Consumes: `Transport`、`types.ts`、`errors.ts`
- Produces: `SdkClient` 类，对外接口 `init`/`open`/`startScan`/`dispose`/`disposeSession`/`on('event')`。

- [ ] **Step 1: 实现 sdk-client.ts**

`src/main/sdk-service/sdk-client.ts`：

```ts
import { EventEmitter } from 'node:events'
import type { Transport } from './transport/types'
import type { Session, Handle, SdkConfig, SdkEvent } from './types'

export class SdkClient {
  private readonly transport: Transport
  private readonly emitter = new EventEmitter()

  constructor(transport: Transport) {
    this.transport = transport
    this.transport.on('data', (data) => {
      this.emitter.emit('event', data)
    })
  }

  init(config: SdkConfig): Promise<Session> {
    return this.transport.invoke<Session>('init', [config])
  }

  open(session: Session): Promise<Handle> {
    return this.transport.invoke<Handle>('open', [session.id])
  }

  startScan(handle: Handle): Promise<void> {
    return this.transport.invoke<void>('start', [handle.id])
  }

  dispose(handle: Handle): Promise<void> {
    return this.transport.invoke<void>('release', [handle.id])
  }

  disposeSession(session: Session): Promise<void> {
    return this.transport.invoke<void>('close', [session.id])
  }

  on(event: 'event', cb: (e: SdkEvent) => void): void {
    this.emitter.on(event, cb)
  }

  terminate(): void {
    this.transport.terminate()
  }
}
```

- [ ] **Step 2: 写 client 集成测试**

`tests/sdk/client.test.ts`：

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { join } from 'node:path'
import { WorkerTransport } from '../../src/main/sdk-service/transport/worker-transport'
import { SdkClient } from '../../src/main/sdk-service/sdk-client'
import type { SdkEvent } from '../../src/main/sdk-service/types'

const workerScript = join(process.cwd(), 'out/main/workers/sdk.worker.js')

describe('SdkClient', () => {
  let client: SdkClient

  afterEach(() => {
    client?.terminate()
  })

  it('端到端：init → open → startScan → 收到事件 → dispose', async () => {
    const transport = new WorkerTransport(workerScript)
    client = new SdkClient(transport)

    const session = await client.init({ mode: 1, logger: { level: 0, prefix: '' } })
    const handle = await client.open(session)

    const events: SdkEvent[] = []
    client.on('event', (e) => events.push(e))

    await client.startScan(handle)
    const deadline = Date.now() + 3000
    while (events.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20))
    }
    expect(events.length).toBeGreaterThanOrEqual(2)

    await client.dispose(handle)
    await client.disposeSession(session)
  })
})
```

- [ ] **Step 3: 构建并运行**

```bash
npm run build:mock && npm run build && npx vitest run --config vitest.config.integration.ts tests/sdk/client.test.ts
```

预期：PASS。

- [ ] **Step 4: Commit**

```bash
git add src/main/sdk-service/sdk-client.ts tests/sdk/client.test.ts
git commit -m "feat(sdk): SdkClient Promise facade 与事件转发"
```

---

### Task 8: IPC 契约扩展（shared）

**Files:**
- Modify: `src/shared/ipc/channels.ts`, `src/shared/ipc/api.ts`
- Create: `tests/shared/ipc/sdk-contract.test.ts`

**Interfaces:**
- Consumes: `types.ts`（类型）
- Produces: `CHANNELS.sdk.*`、zod schema、`RendererApi.sdk`。

- [ ] **Step 1: 扩展 channels.ts**

在 `src/shared/ipc/channels.ts` 末尾追加：

```ts
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
```

- [ ] **Step 2: 扩展 api.ts**

把 `src/shared/ipc/api.ts` 替换为：

```ts
import type { VersionInfo } from './channels'

export interface SdkConfig {
  mode: number
  logger: { level: number; prefix: string }
}

export interface SdkEvent {
  handleId: number
  eventType: number
  payload: string
}

export interface SdkApi {
  init(config: SdkConfig): Promise<{ id: number }>
  open(sessionId: number): Promise<{ id: number }>
  startScan(handleId: number): Promise<void>
  dispose(handleId: number): Promise<void>
  disposeSession(sessionId: number): Promise<void>
  on(event: 'event', cb: (e: SdkEvent) => void): () => void
}

export interface RendererApi {
  ping(): Promise<{ ok: boolean }>
  getVersion(): Promise<VersionInfo>
  sdk: SdkApi
}
```

> `SdkConfig`/`SdkEvent` 在 shared 内定义并导出，供渲染进程（`SdkView`）与 preload 共用；与主进程 `src/main/sdk-service/types.ts` 中的同名类型结构相同，靠 TS 结构化类型在 `register.ts` 处互通（`validate(sdkConfigSchema, ...)` 的返回值喂给 `SdkClient.init`）。`on()` 返回取消订阅函数。

- [ ] **Step 3: 写契约单测**

`tests/shared/ipc/sdk-contract.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { validate } from '../../../src/shared/ipc/validate'
import { sdkConfigSchema, sdkSessionSchema, sdkHandleSchema, sdkEventSchema } from '../../../src/shared/ipc/channels'

describe('SDK IPC 契约', () => {
  it('合法 config 通过', () => {
    const cfg = { mode: 1, logger: { level: 2, prefix: 't' } }
    expect(validate(sdkConfigSchema, cfg)).toEqual(cfg)
  })

  it('config 缺 logger 被拒', () => {
    expect(() => validate(sdkConfigSchema, { mode: 1 })).toThrow()
  })

  it('session/handle 必须是正整数 id', () => {
    expect(validate(sdkSessionSchema, { id: 1 })).toEqual({ id: 1 })
    expect(() => validate(sdkSessionSchema, { id: 'x' })).toThrow()
  })

  it('事件 schema 校验 payload 为字符串', () => {
    const ev = { handleId: 1, eventType: 2, payload: '{"x":1}' }
    expect(validate(sdkEventSchema, ev)).toEqual(ev)
    expect(() => validate(sdkEventSchema, { handleId: 1, eventType: 2, payload: 123 })).toThrow()
  })
})
```

- [ ] **Step 4: 运行单测**

```bash
npx vitest run tests/shared/ipc/sdk-contract.test.ts
```

预期：PASS。

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc/channels.ts src/shared/ipc/api.ts tests/shared/ipc/sdk-contract.test.ts
git commit -m "feat(sdk): IPC 契约扩展（sdk 通道与 zod schema）"
```

---

### Task 9: 主进程 handler、preload 与渲染验证页

**Files:**
- Modify: `src/main/ipc/register.ts`, `src/preload/index.ts`, `src/renderer/src/router.ts`
- Create: `src/renderer/src/views/SdkView.vue`
- Create: `tests/renderer/sdk-view.test.ts`

**Interfaces:**
- Consumes: `SdkClient`、`SDK_CHANNELS`、`RendererApi.sdk`
- Produces: `registerIpc` 注册 sdk handler；`window.api.sdk.*`；`/sdk` 路由页面。

- [ ] **Step 1: 修改 register.ts 接入 SdkClient**

把 `src/main/ipc/register.ts` 替换为：

```ts
import { app, ipcMain, BrowserWindow } from 'electron'
import { CHANNELS, pingResultSchema, versionResultSchema, SDK_CHANNELS, sdkConfigSchema, sdkSessionSchema, sdkHandleSchema } from '@shared/ipc/channels'
import { validate } from '@shared/ipc/validate'
import { WorkerTransport } from '../sdk-service/transport/worker-transport'
import { SdkClient } from '../sdk-service/sdk-client'

let client: SdkClient | null = null

function ensureClient(): SdkClient {
  if (!client) {
    client = new SdkClient(new WorkerTransport())
    client.on('event', (e) => {
      // 广播事件到所有渲染窗口
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(SDK_CHANNELS.event, e)
      }
    })
  }
  return client
}

export function registerIpc(): void {
  ipcMain.handle(CHANNELS.ping, () => validate(pingResultSchema, { ok: true }))

  ipcMain.handle(CHANNELS.getVersion, () =>
    validate(versionResultSchema, {
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      platform: process.platform
    })
  )

  ipcMain.handle(SDK_CHANNELS.init, (_e, config) => {
    const c = ensureClient()
    return c.init(validate(sdkConfigSchema, config))
  })
  ipcMain.handle(SDK_CHANNELS.open, (_e, sessionId) => {
    const { id } = validate(sdkSessionSchema, { id: sessionId })
    return ensureClient().open({ id })
  })
  ipcMain.handle(SDK_CHANNELS.startScan, (_e, handleId) => {
    const { id } = validate(sdkHandleSchema, { id: handleId })
    return ensureClient().startScan({ id })
  })
  ipcMain.handle(SDK_CHANNELS.dispose, (_e, handleId) => {
    const { id } = validate(sdkHandleSchema, { id: handleId })
    return ensureClient().dispose({ id })
  })
  ipcMain.handle(SDK_CHANNELS.disposeSession, (_e, sessionId) => {
    const { id } = validate(sdkSessionSchema, { id: sessionId })
    return ensureClient().disposeSession({ id })
  })
}
```

- [ ] **Step 2: 修改 preload 暴露 window.api.sdk**

把 `src/preload/index.ts` 替换为：

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, SDK_CHANNELS } from '@shared/ipc/channels'
import type { RendererApi } from '@shared/ipc/api'

const api: RendererApi = {
  ping: () => ipcRenderer.invoke(CHANNELS.ping) as Promise<{ ok: boolean }>,
  getVersion: () => ipcRenderer.invoke(CHANNELS.getVersion),
  sdk: {
    init: (config) => ipcRenderer.invoke(SDK_CHANNELS.init, config),
    open: (sessionId) => ipcRenderer.invoke(SDK_CHANNELS.open, sessionId),
    startScan: (handleId) => ipcRenderer.invoke(SDK_CHANNELS.startScan, handleId),
    dispose: (handleId) => ipcRenderer.invoke(SDK_CHANNELS.dispose, handleId),
    disposeSession: (sessionId) => ipcRenderer.invoke(SDK_CHANNELS.disposeSession, sessionId),
    on: (event, cb) => {
      const handler = (_e: unknown, data: Parameters<typeof cb>[0]): void => cb(data)
      ipcRenderer.on(SDK_CHANNELS.event, handler)
      return () => ipcRenderer.removeListener(SDK_CHANNELS.event, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
```

- [ ] **Step 3: 创建 SdkView.vue**

`src/renderer/src/views/SdkView.vue`：

```vue
<script setup lang="ts">
import { ref } from 'vue'
import type { SdkEvent } from '@shared/ipc/api'

const sessionId = ref<number | null>(null)
const handleId = ref<number | null>(null)
const events = ref<SdkEvent[]>([])
const error = ref('')

async function run(): Promise<void> {
  events.value = []
  error.value = ''
  try {
    const session = await window.api.sdk.init({ mode: 1, logger: { level: 0, prefix: '' } })
    sessionId.value = session.id
    const handle = await window.api.sdk.open(session.id)
    handleId.value = handle.id
    const off = window.api.sdk.on('event', (e) => {
      events.value.push(e)
    })
    await window.api.sdk.startScan(handle.id)
    // 3 秒后清理
    setTimeout(async () => {
      off()
      await window.api.sdk.dispose(handle.id)
      await window.api.sdk.disposeSession(session.id)
    }, 3000)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <main>
    <h1>SDK POC</h1>
    <button @click="run">运行 init → open → startScan</button>
    <p v-if="error" style="color: red">{{ error }}</p>
    <p>session: {{ sessionId ?? '-' }} / handle: {{ handleId ?? '-' }}</p>
    <ul>
      <li v-for="(e, i) in events" :key="i">{{ e.eventType }}: {{ e.payload }}</li>
    </ul>
  </main>
</template>
```

- [ ] **Step 4: 加路由**

修改 `src/renderer/src/router.ts`：

```ts
import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from './views/HomeView.vue'
import SdkView from './views/SdkView.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: HomeView },
    { path: '/sdk', component: SdkView }
  ]
})
```

- [ ] **Step 5: 写 SdkView 组件单测**

`tests/renderer/sdk-view.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import SdkView from '../../src/renderer/src/views/SdkView.vue'
import type { RendererApi } from '../../src/shared/ipc/api'

beforeEach(() => {
  const off = vi.fn()
  window.api = {
    ping: vi.fn(),
    getVersion: vi.fn(),
    sdk: {
      init: vi.fn().mockResolvedValue({ id: 1 }),
      open: vi.fn().mockResolvedValue({ id: 2 }),
      startScan: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      disposeSession: vi.fn().mockResolvedValue(undefined),
      on: vi.fn().mockImplementation((_event, cb) => {
        // 模拟立即投递一个事件
        setTimeout(() => cb({ handleId: 2, eventType: 1, payload: '{"status":"started"}' }), 0)
        return () => {}
      })
    }
  } as unknown as RendererApi
})

describe('SdkView', () => {
  it('点击按钮后显示 session/handle 与事件', async () => {
    const wrapper = mount(SdkView)
    await wrapper.find('button').trigger('click')
    // 等待 Promise + setTimeout
    await new Promise((r) => setTimeout(r, 10))
    expect(wrapper.text()).toContain('session: 1')
    expect(wrapper.text()).toContain('handle: 2')
    expect(wrapper.text()).toContain('started')
  })
})
```

- [ ] **Step 6: 运行单测 + typecheck**

```bash
npx vitest run tests/renderer/sdk-view.test.ts
npm run typecheck
```

预期：PASS，typecheck 通过。

- [ ] **Step 7: Commit**

```bash
git add src/main/ipc/register.ts src/preload/index.ts src/renderer/src/views/SdkView.vue src/renderer/src/router.ts tests/renderer/sdk-view.test.ts
git commit -m "feat(sdk): 主进程 handler、preload API 与渲染验证页"
```

---

### Task 10: 配置收尾与全量验证

**Files:**
- Modify: `vitest.config.ts`, `package.json`
- Modify: `src/renderer/src/views/HomeView.vue`（加 SDK 页入口链接，可选）

**Interfaces:**
- Consumes: 前 9 个 Task
- Produces: `npm test`（单测）/ `npm run test:integration`（集成）/ `npm run test:all` 三脚本可用且全绿。

- [ ] **Step 1: 修改 vitest.config.ts**

把 `vitest.config.ts` 替换为：

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
    globals: true,
    exclude: ['tests/sdk/**', '.worktrees/**', 'node_modules/**']
  }
})
```

> 排除 `tests/sdk/**`（集成测试走 `vitest.config.integration.ts`）与 `.worktrees/**`（修子计划 1 遗留的重复计数）。

- [ ] **Step 2: 加 test 脚本到 package.json**

修改 `package.json` 的 `scripts`，加：

```json
"test:integration": "npm run build:mock && npm run build && vitest run --config vitest.config.integration.ts",
"test:all": "npm run test && npm run test:integration"
```

- [ ] **Step 3: HomeView 加入口链接（可选）**

修改 `src/renderer/src/views/HomeView.vue` 的 `<template>`，在 `<p>` 后加：

```vue
    <p><RouterLink to="/sdk">SDK POC</RouterLink></p>
```

- [ ] **Step 4: 全量验证**

```bash
npm run typecheck
npm test
npm run test:integration
npm run build
```

预期：typecheck 通过；单测全绿；集成测试全绿（含 §11 #4 回调编组）；build 产出 `out/main/workers/sdk.worker.js`。

- [ ] **Step 5: 手动冒烟（可选）**

```bash
npm run dev
```

预期：窗口首页有 "SDK POC" 链接，点击进入 `/sdk`，点按钮后显示 session/handle 与回调事件列表。

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts package.json src/renderer/src/views/HomeView.vue
git commit -m "chore(sdk): 测试配置收尾与全量验证"
```

---

## 自检记录

- **Spec 覆盖：** §3 mock 库→Task 1；§4 transport/worker→Task 4；§4.4 回调编组→Task 5；§5 错误→Task 2/6；§6 内存→Task 6；§7 测试→各 Task；§8 工程集成→Task 8/9/10；§10 验收→Task 10 Step 4。
- **类型一致性：** `Session`/`Handle` 在 `types.ts`、`sdk-client.ts`、`channels.ts` schema 中均为 `{ id: number }`；`SdkConfig`/`SdkEvent` 在 shared `api.ts`（渲染契约）与主进程 `types.ts`（内部用）结构相同，靠 TS 结构化类型在 `register.ts` 互通；`SdkEvent` 字段 `handleId/eventType/payload` 在 `api.ts`、worker 事件、`sdkEventSchema`、`SdkView`、preload 一致；`CHANNELS` vs `SDK_CHANNELS` 两套命名明确分离。
- **无占位符：** 所有代码块完整可执行；Task 4 worker 的回调注册（`registerCallback` + struct `cb` 字段）一次写对，无悬空修正。
- **已知风险：** Task 5（§11 #4）标注了挂起/崩溃时的兜底方向；worker 构建用 rollupOptions 多入口，若 electron-vite 对子目录 key 输出有问题，回退为 esbuild 单独编译 worker（`esbuild src/main/sdk-service/workers/sdk.worker.ts --bundle --platform=node --external:koffi --outfile=out/main/workers/sdk.worker.js`）。
