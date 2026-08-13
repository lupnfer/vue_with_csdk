import type Database from 'better-sqlite3-multiple-ciphers'

export const SCHEMA_VERSION = 1

interface Migration {
  version: number
  sql: string
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS app_config (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS secret_config (
        key   TEXT PRIMARY KEY,
        value BLOB NOT NULL,
        updated_at TEXT NOT NULL
      );
    `
  }
]

export function migrate(db: Database.Database): void {
  // schema_migrations 必须先建（全新库无任何表）
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `)
  const applied = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]
  const appliedSet = new Set(applied.map((r) => r.version))

  for (const m of MIGRATIONS) {
    if (appliedSet.has(m.version)) continue
    const tx = db.transaction(() => {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        m.version,
        new Date().toISOString()
      )
    })
    tx()
  }
}
