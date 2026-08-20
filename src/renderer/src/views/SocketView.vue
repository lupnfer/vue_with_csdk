<template>
  <div class="socket-view">
    <h2>Socket POC（裸报文修改 IP）</h2>
    <p>通过 UDP 组播裸报文向设备发送修改 IP 指令（不经 SDK）。</p>
    <form @submit.prevent="onSubmit">
      <label>MAC <input v-model="mac" placeholder="00:11:22:33:44:55" /></label>
      <label>新 IP <input v-model="newIp" placeholder="192.168.1.100" /></label>
      <label>掩码 <input v-model="mask" placeholder="255.255.255.0" /></label>
      <label>网关 <input v-model="gateway" placeholder="192.168.1.1" /></label>
      <button type="button" @click="onSubmit" :disabled="loading">{{ loading ? '发送中...' : '发送修改 IP 指令' }}</button>
    </form>
    <p v-if="result">已发送</p>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const mac = ref('')
const newIp = ref('')
const mask = ref('')
const gateway = ref('')
const loading = ref(false)
const result = ref<{ ok: boolean } | null>(null)
const error = ref('')

async function onSubmit(): Promise<void> {
  loading.value = true
  error.value = ''
  result.value = null
  try {
    result.value = await window.api.socket.modifyIp({
      mac: mac.value,
      newIp: newIp.value,
      mask: mask.value,
      gateway: gateway.value
    })
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}
</script>
