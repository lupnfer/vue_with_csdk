<script setup lang="ts">
import { onMounted } from 'vue'
import { useAppStore } from '../stores/app'

const store = useAppStore()
onMounted(() => store.loadVersion())
</script>

<template>
  <main>
    <h1>Code Reader Client</h1>
    <p>应用版本：{{ store.version || '加载中…' }}</p>
  </main>
</template>
