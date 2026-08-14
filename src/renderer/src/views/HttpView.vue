<script setup lang="ts">
import { ref } from 'vue'

const path = ref('/users')
const method = ref<'get' | 'post'>('get')
const result = ref('')
const error = ref('')

async function send(): Promise<void> {
  result.value = ''
  error.value = ''
  try {
    const fn = method.value === 'get' ? window.api.http.get : window.api.http.post
    const res = await fn(path.value)
    result.value = JSON.stringify(res.body, null, 2)
  } catch (e) {
    error.value = (e as { message?: string })?.message ?? String(e)
  }
}

async function setToken(): Promise<void> {
  const t = prompt('输入 token')
  if (t) await window.api.http.setToken(t)
}
</script>

<template>
  <main>
    <h1>HTTP POC</h1>
    <p v-if="error" style="color: red">{{ error }}</p>
    <select v-model="method">
      <option value="get">GET</option>
      <option value="post">POST</option>
    </select>
    <input v-model="path" placeholder="/path" />
    <button @click="send">发送</button>
    <button @click="setToken">设置 Token</button>
    <pre>{{ result }}</pre>
  </main>
</template>
