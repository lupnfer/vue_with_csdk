<script setup lang="ts">
import { ref } from 'vue'

const appKey = ref('theme')
const appValue = ref('')
const appResult = ref('')

const secretKey = ref('api_token')
const secretValue = ref('')
const secretResult = ref('')

const error = ref('')

async function setApp(): Promise<void> {
  error.value = ''
  try {
    await window.api.db.setAppConfig(appKey.value, appValue.value)
    appResult.value = '已保存'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function getApp(): Promise<void> {
  error.value = ''
  try {
    const v = await window.api.db.getAppConfig(appKey.value)
    appResult.value = v ?? '(空)'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function setSecret(): Promise<void> {
  error.value = ''
  try {
    await window.api.db.setSecretConfig(secretKey.value, secretValue.value)
    secretResult.value = '已保存（加密）'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function getSecret(): Promise<void> {
  error.value = ''
  try {
    const v = await window.api.db.getSecretConfig(secretKey.value)
    secretResult.value = v ?? '(空)'
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}
</script>

<template>
  <main>
    <h1>DB POC</h1>
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
