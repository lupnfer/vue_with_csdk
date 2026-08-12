import { defineStore } from 'pinia'

export const useAppStore = defineStore('app', {
  state: () => ({
    version: '' as string
  }),
  actions: {
    async loadVersion(): Promise<void> {
      this.version = (await window.api.getVersion()).version
    }
  }
})
