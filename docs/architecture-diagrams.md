# 架构逻辑视图（sdk-service / db-service / http-client）

## sdk-service

### 静态视图（类图 / 模块结构）

```mermaid
classDiagram
    class ISdkClient {
        <<interface>>
        +init(config: SdkConfig) Promise~Session~
        +open(session: Session) Promise~Handle~
        +startScan(handle: Handle) Promise~void~
        +discover() Promise~DiscoveredDevice[]~
        +dispose(handle: Handle) Promise~void~
        +disposeSession(session: Session) Promise~void~
        +on(event, cb) void
        +off(event, cb) void
    }

    class SdkClient {
        -transport: Transport
        -emitter: EventEmitter
        +init(config) Promise~Session~
        +open(session) Promise~Handle~
        +startScan(handle) Promise~void~
        +discover() Promise~DiscoveredDevice[]~
        +dispose(handle) Promise~void~
        +disposeSession(session) Promise~void~
        +on(event, cb) void
        +off(event, cb) void
        +terminate() void
    }

    class SdkBinding {
        <<interface>>
        +init(config: SdkInitConfig) boolean
        +registerLogCallback(cb) boolean
        +discoverLocalDevices() DiscoveredDevice[]
        +cleanup() boolean
        +getLastError() number
        +getErrorMsg(no) string
    }

    class MockBinding {
        +init(config) boolean
        +registerLogCallback(cb) boolean
        +discoverLocalDevices() DiscoveredDevice[]
        +cleanup() boolean
        +getLastError() number
        +getErrorMsg(no) string
    }

    class RealBinding {
        -lib: KoffiLibrary
        -IVS_PU_InitEx: function
        -IVS_PU_DiscoveryLocalDeviceList: function
        -IVS_PU_Cleanup: function
        -IVS_PU_WriteLogCallBack: function
        +init(config) boolean
        +registerLogCallback(cb) boolean
        +discoverLocalDevices() DiscoveredDevice[]
        +cleanup() boolean
    }

    class BindingSelector {
        +selectBinding() SdkBinding
    }

    class WorkerTransport {
        -worker: Worker
        -pending: Map
        -emitter: EventEmitter
        +invoke(method, args) Promise
        +on(event, cb) void
        +terminate() void
        -handleMessage(msg) void
    }

    class SdkWorker {
        -sessions: Map
        -handles: Map
        -handleCallbacks: Map
        +case init / open / start / release / close / discover / cleanup
    }

    ISdkClient <|.. SdkClient
    SdkBinding <|.. MockBinding
    SdkBinding <|.. RealBinding
    SdkClient --> WorkerTransport : invoke / on
    WorkerTransport --> SdkWorker : MessagePort
    SdkWorker --> BindingSelector : selectBinding()
    BindingSelector --> MockBinding : CRC_SDK_MODE=mock
    BindingSelector --> RealBinding : CRC_SDK_MODE=real
    RealBinding --> HWPuSDK : Koffi FFI
    MockBinding --> MockC : Koffi FFI
```

### 动态视图（时序图 — 二层搜索端到端）

```mermaid
sequenceDiagram
    participant R as Electron进程::Renderer
    participant P as Electron进程::Preload
    participant M as Electron进程::Main::SdkClient
    participant T as Electron进程::Main::WorkerTransport
    participant W as Electron进程::Main::Worker
    participant B as SdkBinding
    participant DLL as HWPuSDK.dll

    R->>P: window.api.sdk.discover()
    P->>M: IPC invoke('sdk:discover')
    M->>T: transport.invoke('discover', [])
    T->>W: postMessage(InvokeMessage)
    W->>B: binding.discoverLocalDevices()
    B->>DLL: IVS_PU_DiscoveryLocalDeviceList(&list)
    DLL-->>B: BOOL + 设备列表结构体
    B->>B: 解码 stDeviceInfo[0..n] → DiscoveredDevice[]
    B-->>W: DiscoveredDevice[]
    W-->>T: postMessage(ResultMessage)
    T-->>M: resolve(DiscoveredDevice[])
    M-->>P: Promise resolve
    P-->>R: DiscoveredDevice[]
    R->>R: 渲染设备列表
```

### 动态视图（时序图 — mock 扫描 + 异步回调）

```mermaid
sequenceDiagram
    participant R as Electron进程::Renderer
    participant M as Electron进程::Main::SdkClient
    participant T as Electron进程::Main::WorkerTransport
    participant W as Electron进程::Main::Worker
    participant B as MockBinding
    participant C as mock C 库

    R->>M: sdk.init(config)
    M->>T: invoke('init', [config])
    T->>W: postMessage
    W->>B: crcInit(config)
    B->>C: crc_sdk_init()
    C-->>B: session ptr
    B-->>W: { id }
    W-->>T: result
    T-->>M: Session
    M-->>R: { id: 1 }

    R->>M: sdk.open(session)
    M->>T: invoke('open', [id])
    W->>B: crcOpen(ptr, {cb})
    B->>C: crc_sdk_open()
    C-->>B: handle ptr
    B-->>W: { id }
    W-->>T: result
    T-->>M: Handle
    M-->>R: { id: 1 }

    R->>M: sdk.on('event', cb)
    M->>T: 注册 emitter

    R->>M: sdk.startScan(handle)
    M->>T: invoke('start', [id])
    T->>W: postMessage
    W->>B: crcStartScan(ptr)
    B->>C: crc_sdk_start_scan()
    C-->>C: pthread_create (detached)
    C-->>B: return 0 (立即)
    B-->>W: ok
    W-->>T: result(null)
    T-->>M: resolve
    M-->>R: void

    Note over C: 20ms 后 pthread 触发回调
    C->>B: cb(1, '{"status":"started"}')
    B->>W: postMessage(EventMessage)
    W->>T: postMessage(event)
    T->>M: emitter.emit('data')
    M->>R: cb(SdkEvent)

    Note over C: 50ms 后第二次回调
    C->>B: cb(2, '{"status":"done"}')
    B->>W: postMessage(EventMessage)
    W->>T: postMessage(event)
    T->>M: emitter.emit('data')
    M->>R: cb(SdkEvent)
```

---

## db-service

### 静态视图（类图 / 模块结构）

```mermaid
classDiagram
    class IDbClient {
        <<interface>>
        +getAppConfig(key) string|null
        +setAppConfig(key, value) void
        +deleteAppConfig(key) void
        +listAppConfig() ConfigEntry[]
        +getSecretConfig(key) string|null
        +setSecretConfig(key, value) void
        +deleteSecretConfig(key) void
        +listSecretConfig() ConfigEntry[]
    }

    class DbClient {
        -db: Database|null
        -repos: Repositories|null
        -path: string
        -keyProvider: KeyProvider
        +open() Promise~void~
        +getAppConfig(key) string|null
        +setAppConfig(key, value) void
        +deleteAppConfig(key) void
        +listAppConfig() ConfigEntry[]
        +getSecretConfig(key) string|null
        +setSecretConfig(key, value) void
        +deleteSecretConfig(key) void
        +listSecretConfig() ConfigEntry[]
        +close() void
        -ensure() Repositories
    }

    class KeyProvider {
        <<interface>>
        +loadKeys() Promise~DbKeys~
        +saveKeys(keys) Promise~void~
    }

    class DbKeys {
        +dbKey: Buffer
        +fieldKey: Buffer
    }

    class SafeStorageKeyProvider {
        -keysFile: string
        +loadKeys() Promise~DbKeys~
        +saveKeys(keys) Promise~void~
    }

    class StaticKeyProvider {
        -keys: DbKeys
        +loadKeys() Promise~DbKeys~
        +saveKeys() Promise~void~
    }

    class Repositories {
        -db: Database
        -fieldKey: Buffer
        +getAppConfig(key) string|null
        +setAppConfig(key, value) void
        +deleteAppConfig(key) void
        +listAppConfig() ConfigEntry[]
        +getSecretConfig(key) string|null
        +setSecretConfig(key, value) void
        +deleteSecretConfig(key) void
        +listSecretConfig() ConfigEntry[]
    }

    class FieldCipher {
        +encryptField(plaintext, key) Buffer
        +decryptField(blob, key) string
    }

    class Migrations {
        +SCHEMA_VERSION: int
        +migrate(db) void
    }

    class DbError {
        +code: string
        +category: DbErrorCategory
        +retryable: boolean
    }

    IDbClient <|.. DbClient
    KeyProvider <|.. SafeStorageKeyProvider
    KeyProvider <|.. StaticKeyProvider
    DbClient --> KeyProvider : loadKeys
    DbClient --> Repositories : CRUD 委托
    Repositories --> FieldCipher : secret_config 加解密
    Repositories --> Migrations : schema 迁移
    SafeStorageKeyProvider --> ElectronSafeStorage : DPAPI/Keychain
```

### 静态视图（ER 图 — 数据库表结构）

```mermaid
erDiagram
    app_config {
        TEXT key PK
        TEXT value
        TEXT updated_at
    }

    secret_config {
        TEXT key PK
        BLOB value "AES-256-GCM 密文"
        TEXT updated_at
    }

    schema_migrations {
        INTEGER version PK
        TEXT applied_at
    }
```

### 动态视图（时序图 — 加密库打开 + CRUD）

```mermaid
sequenceDiagram
    participant R as Electron进程::Renderer
    participant M as Electron进程::Main::DbClient
    participant K as Electron进程::Main::KeyProvider
    participant D as Electron进程::Main::openEncryptedDb
    participant Mig as Electron进程::Main::Migrations
    participant Repo as Electron进程::Main::Repositories
    participant FC as Electron进程::Main::FieldCipher
    participant DB as SQLite

    R->>M: db.setSecretConfig('token', 'secret-val')
    M->>M: ensure() → repos

    Note over M: 首次调用时 open()
    M->>K: loadKeys()
    K-->>M: { dbKey, fieldKey }
    M->>D: openEncryptedDb(path, dbKey)
    D->>DB: new Database(path)
    D->>DB: db.key(dbKey)
    D->>DB: SELECT count(*) FROM sqlite_master
    DB-->>D: 验证密钥通过
    D-->>M: Database

    M->>Mig: migrate(db)
    Mig->>DB: CREATE TABLE app_config / secret_config / schema_migrations
    Mig->>DB: INSERT schema_migrations (1)
    Mig-->>M: done

    M->>Repo: new Repositories(db, fieldKey)

    Note over M: CRUD 执行
    M->>Repo: setSecretConfig('token', 'secret-val')
    Repo->>FC: encryptField('secret-val', fieldKey)
    FC-->>Repo: Buffer (iv+tag+ciphertext)
    Repo->>DB: INSERT INTO secret_config VALUES ('token', blob, now)
    DB-->>Repo: ok
    Repo-->>M: void
    M-->>R: Promise resolve
```

### 动态视图（时序图 — 密钥错误检测）

```mermaid
sequenceDiagram
    participant M as Electron进程::Main::DbClient
    participant K as Electron进程::Main::KeyProvider
    participant D as Electron进程::Main::openEncryptedDb
    participant DB as SQLite

    M->>K: loadKeys()
    K-->>M: { dbKey: 错误密钥 }
    M->>D: openEncryptedDb(path, wrongKey)
    D->>DB: new Database(path)
    D->>DB: db.key(wrongKey)
    D->>DB: SELECT count(*) FROM sqlite_master
    DB-->>D: SQLITE_NOTADB (密钥不匹配)
    D->>D: db.close()
    D-->>M: DbError(DB_KEY_ERROR)
    M-->>M: 抛出，UI 提示"密钥问题"
```

---

## http-client

### 静态视图（类图 / 模块结构）

```mermaid
classDiagram
    class IHttpClient {
        <<interface>>
        +get(path, opts) Promise~TypedResponse~
        +post(path, opts) Promise~TypedResponse~
        +tokens: TokenStore
    }

    class HttpClient {
        -transport: HttpTransport
        +tokens: TokenStore
        -config: HttpConfig
        -refreshPromise: Promise|null
        +get(path, opts) Promise~TypedResponse~
        +post(path, opts) Promise~TypedResponse~
        +put(path, opts) Promise~TypedResponse~
        +delete(path, opts) Promise~TypedResponse~
        -request(method, path, opts) Promise~TypedResponse~
        -buildRequest(method, url, headers, body, timeout) HttpRequest
        -backoff(attempt) Promise~void~
        -refreshTokens() Promise~string~
        -toHttpError(e) HttpError
        -logError(method, path, err, attempt) void
    }

    class HttpTransport {
        <<interface>>
        +send(req: HttpRequest) Promise~HttpResponse~
    }

    class NetTransport {
        -getNet() net module
        +send(req) Promise~HttpResponse~
    }

    class FakeTransport {
        +requests: HttpRequest[]
        +send(req) Promise~HttpResponse~
    }

    class TokenStore {
        <<interface>>
        +getToken() Promise~string|null~
        +setToken(token) Promise~void~
        +getRefreshToken() Promise~string|null~
        +setRefreshToken(token) Promise~void~
        +clear() Promise~void~
    }

    class DbTokenStore {
        -secrets: SecretStore
    }

    class InMemoryTokenStore {
        -token: string|null
        -refresh: string|null
    }

    class HttpConfig {
        +baseUrl: string
        +refreshUrl: string
        +timeoutMs: number
        +maxRetries: number
    }

    class DbHttpConfig {
        -store: AppConfigStore
        -cached: HttpConfig|null
        +load() Promise~HttpConfig~
        +set(config) Promise~void~
    }

    class HttpError {
        +kind: HttpErrorKind
        +status: number
        +retryable: boolean
    }

    IHttpClient <|.. HttpClient
    HttpTransport <|.. NetTransport
    HttpTransport <|.. FakeTransport
    TokenStore <|.. DbTokenStore
    TokenStore <|.. InMemoryTokenStore
    HttpClient --> HttpTransport : send
    HttpClient --> TokenStore : token 注入
    HttpClient --> HttpConfig : baseUrl/timeout
    DbTokenStore --> SecretStore : db secret_config
    DbHttpConfig --> AppConfigStore : db app_config
    NetTransport --> ElectronNet : net.request
```

### 动态视图（时序图 — GET 请求 + 指数退避重试）

```mermaid
sequenceDiagram
    participant R as Electron进程::Renderer
    participant H as Electron进程::Main::HttpClient
    participant T as Electron进程::Main::HttpTransport
    participant TS as Electron进程::Main::TokenStore

    R->>H: get('/users')
    H->>TS: getToken()
    TS-->>H: 'my-token'
    H->>T: send({ method: GET, url: baseUrl+/users, headers: {Authorization: Bearer my-token} })
    T-->>H: { status: 500, body: 'err' }
    H->>H: toHttpError → HttpError(server, 500, retryable=true)
    H->>H: logError (electron-log, 无 token)
    Note over H: GET 是幂等 → 重试
    H->>H: backoff(1) — 200ms × 2^0 × jitter
    H->>T: send({ ... 同上 })
    T-->>H: { status: 200, body: '{"users":[]}' }
    H->>H: parseBody → JSON
    H-->>R: TypedResponse { status: 200, body: {users:[]} }
```

### 动态视图（时序图 — 401 刷新重放 + single-flight）

```mermaid
sequenceDiagram
    participant R1 as Electron进程::Renderer::请求A
    participant R2 as Electron进程::Renderer::请求B
    participant H as Electron进程::Main::HttpClient
    participant T as Electron进程::Main::HttpTransport
    participant TS as Electron进程::Main::TokenStore

    par 请求 A
        R1->>H: get('/data')
        H->>T: send({ Authorization: Bearer old-t })
        T-->>H: { status: 401 }
        H->>H: 401 + !refreshed → refreshTokens()
        H->>TS: getRefreshToken()
        TS-->>H: 'old-r'
        H->>T: send({ POST refreshUrl, body: {refreshToken: old-r} })
        T-->>H: { status: 200, body: {token: new-t, refreshToken: new-r} }
        H->>TS: setToken('new-t')
        H->>TS: setRefreshToken('new-r')
        Note over H: refreshPromise = null (single-flight 完成)
        H->>T: send({ Authorization: Bearer new-t }) — 重放
        T-->>H: { status: 200, body: {data: 'A'} }
        H-->>R1: TypedResponse { data: 'A' }
    and 请求 B（并发）
        R2->>H: get('/data2')
        H->>T: send({ Authorization: Bearer old-t })
        T-->>H: { status: 401 }
        H->>H: 401 + !refreshed → refreshTokens()
        Note over H: refreshPromise 已存在（A 创建的）→ 等待同一 promise
        H->>H: await refreshPromise → new-t
        H->>T: send({ Authorization: Bearer new-t }) — 重放
        T-->>H: { status: 200, body: {data: 'B'} }
        H-->>R2: TypedResponse { data: 'B' }
    end

    Note over H: 只发了 1 次刷新请求（single-flight）
```

### 动态视图（时序图 — POST 不重试 + 错误传播）

```mermaid
sequenceDiagram
    participant R as Electron进程::Renderer
    participant H as Electron进程::Main::HttpClient
    participant T as Electron进程::Main::HttpTransport

    R->>H: post('/items', { body: { name: 'x' } })
    H->>H: buildRequest: JSON.stringify body + Content-Type
    H->>T: send({ method: POST, url, headers, body })
    T-->>H: { status: 500, body: 'server err' }
    H->>H: toHttpError → HttpError(server, 500)
    H->>H: POST 非幂等 → 不重试，直接抛
    H->>H: logError (electron-log.warn)
    H-->>R: reject(HttpError { kind: server, status: 500 })
    R->>R: catch → UI 显示错误
```

### 动态视图（时序图 — setConfig 重建实例）

```mermaid
sequenceDiagram
    participant R as Electron进程::Renderer
    participant Reg as Electron进程::Main::Register
    participant DB as Electron进程::Main::DbClient
    participant HC as Electron进程::Main::HttpClient(旧)
    participant HC2 as Electron进程::Main::HttpClient(新)

    R->>Reg: http.setConfig({ baseUrl: 'http://new-api' })
    Reg->>DB: getAppConfig('http_config')
    DB-->>Reg: 旧配置
    Reg->>DB: setAppConfig('http_config', 新配置 JSON)
    Reg->>Reg: httpClient = null
    Reg->>Reg: httpClientPromise = null
    Note over Reg: 下次 HTTP 请求时重建

    R->>Reg: http.get('/users')
    Reg->>Reg: ensureHttpClient() → httpClientPromise == null → 重建
    Reg->>DB: getAppConfig('http_config')
    DB-->>Reg: 新配置
    Reg->>HC2: new HttpClient(transport, tokenStore, 新config)
    Reg->>HC2: get('/users')
    HC2-->>Reg: TypedResponse
    Reg-->>R: 结果

    Note over HC: 旧实例被 GC（无引用）
```
