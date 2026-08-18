<script setup lang="ts">
import { ref } from 'vue'

const devices = ref<{ name: string; ip: string; mac: string; type: string }[]>([])
const error = ref('')

async function runDiscover(): Promise<void> {
  error.value = ''
  devices.value = []
  try {
    devices.value = await window.api.sdk.discover()
  } catch (e) {
    error.value = (e as { message?: string })?.message ?? String(e)
  }
}
</script>

<template>
  <main>
    <h1>SDK POC</h1>
    <p><RouterLink to="/">← 返回首页</RouterLink></p>
    <button @click="runDiscover">搜索局域网设备</button>
    <p v-if="error" style="color: red">{{ error }}</p>
    <ul v-if="devices.length">
      <li v-for="(d, i) in devices" :key="i">
        {{ d.name }} ({{ d.ip }}) - {{ d.mac }} - {{ d.type }}
      </li>
    </ul>
  </main>
</template>
