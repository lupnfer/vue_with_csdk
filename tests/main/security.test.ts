import { describe, it, expect } from 'vitest'
import { createWebPreferences, buildCsp } from '../../src/main/security'

describe('security', () => {
  it('webPreferences 强制开启隔离、关闭 Node 集成', () => {
    const prefs = createWebPreferences()
    expect(prefs.contextIsolation).toBe(true)
    expect(prefs.nodeIntegration).toBe(false)
  })

  it('CSP 禁止远程脚本与远程连接', () => {
    const csp = buildCsp()
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("connect-src 'self'")
  })
})
