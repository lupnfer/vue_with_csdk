<script setup lang="ts">
import { ref } from 'vue'
import type { SdkEvent } from '@shared/ipc/api'

const sessionId = ref<number | null>(null)
const handleId = ref<number | null>(null)
const events = ref<SdkEvent[]>([])
const error = ref('')
const devices = ref<{ name: string; ip: string; mac: string; type: string }[]>([])

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

async function runDiscover(): Promise<void> {
  error.value = ''
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
    <button @click="run">运行 init → open → startScan</button>
    <button @click="runDiscover">搜索局域网设备</button>
    <p v-if="error" style="color: red">{{ error }}</p>
    <p>session: {{ sessionId ?? '-' }} / handle: {{ handleId ?? '-' }}</p>
    <ul>
      <li v-for="(e, i) in events" :key="i">{{ e.eventType }}: {{ e.payload }}</li>
    </ul>
    <ul v-if="devices.length">
      <li v-for="(d, i) in devices" :key="i">
        {{ d.name }} ({{ d.ip }}) - {{ d.mac }} - {{ d.type }}
      </li>
    </ul>
  </main>
</template>
