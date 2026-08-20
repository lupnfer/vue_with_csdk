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
    <p><RouterLink to="/sdk">SDK POC</RouterLink></p>
    <p><RouterLink to="/db">DB POC</RouterLink></p>
    <p><RouterLink to="/http">HTTP POC</RouterLink></p>
    <p><RouterLink to="/socket">Socket POC</RouterLink></p>
    <p><RouterLink to="/use-case">Use Case POC</RouterLink></p>
  </main>
</template>
