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
