<script setup lang="ts">
import { ref } from 'vue'

const result = ref('')
const error = ref('')

async function runBootstrap(): Promise<void> {
  result.value = ''
  error.value = ''
  try {
    const res = await window.api.useCase.configLoadAuth()
    result.value = JSON.stringify(res, null, 2)
  } catch (e) {
    error.value = (e as { message?: string })?.message ?? String(e)
  }
}
</script>

<template>
  <main>
    <h1>Use Case POC</h1>
    <p><RouterLink to="/">← 返回首页</RouterLink></p>
    <p v-if="error" style="color: red">{{ error }}</p>
    <button @click="runBootstrap">配置加载与鉴权</button>
    <pre>{{ result }}</pre>
  </main>
</template>
