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
