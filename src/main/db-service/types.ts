/** 对外配置条目（无 SQL 细节，value 始终是明文 string） */
export interface ConfigEntry {
  key: string
  value: string
  updatedAt: string
}
