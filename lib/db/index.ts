import Database from 'better-sqlite3'
import path from 'path'
import { runMigrations } from './migrations'

const DB_PATH = path.join(process.cwd(), 'data', 'health.db')

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
    runMigrations(_db)
  }
  return _db
}
