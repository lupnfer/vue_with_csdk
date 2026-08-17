<script setup lang="ts">
import { ref } from 'vue'

const appKey = ref('theme')
const appValue = ref('')
const appResult = ref('')

const secretKey = ref('api_token')
const secretValue = ref('')
const secretResult = ref('')

const error = ref('')

// IPC 把 DbError 序列化成普通对象（{ code, message, ...}）抛回渲染进程，
// 不是 Error 实例，故不能只靠 instanceof Error——优先读 .message。
function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message
  const msg = (e as { message?: unknown })?.message
  return typeof msg === 'string' ? msg : String(e)
}

async function setApp(): Promise<void> {
  error.value = ''
  try {
    await window.api.db.setAppConfig(appKey.value, appValue.value)
    appResult.value = '已保存'
  } catch (e) {
    error.value = errMsg(e)
  }
}

async function getApp(): Promise<void> {
  error.value = ''
  try {
    const v = await window.api.db.getAppConfig(appKey.value)
    appResult.value = v ?? '(空)'
  } catch (e) {
    error.value = errMsg(e)
  }
}

async function setSecret(): Promise<void> {
  error.value = ''
  try {
    await window.api.db.setSecretConfig(secretKey.value, secretValue.value)
    secretResult.value = '已保存（加密）'
  } catch (e) {
    error.value = errMsg(e)
  }
}

async function getSecret(): Promise<void> {
  error.value = ''
  try {
    const v = await window.api.db.getSecretConfig(secretKey.value)
    secretResult.value = v ?? '(空)'
  } catch (e) {
    error.value = errMsg(e)
  }
}
</script>

<template>
  <main>
    <h1>DB POC</h1>
    <p><RouterLink to="/">← 返回首页</RouterLink></p>
    <p v-if="error" style="color: red">{{ error }}</p>

    <section>
      <h2>app_config（明文）</h2>
      <input v-model="appKey" placeholder="key" />
      <input v-model="appValue" placeholder="value" />
      <button @click="setApp">保存</button>
      <button @click="getApp">读取</button>
      <p>结果：{{ appResult }}</p>
    </section>

    <section>
      <h2>secret_config（字段加密）</h2>
      <input v-model="secretKey" placeholder="key" />
      <input v-model="secretValue" placeholder="value" />
      <button @click="setSecret">保存</button>
      <button @click="getSecret">读取</button>
      <p>结果：{{ secretResult }}</p>
    </section>
  </main>
</template>
