import type { Database } from 'better-sqlite3';
import { readFileSync } from 'node:fs';
export function migrate(db:Database):void {
 const sql=readFileSync(new URL('../../migrations/001_core.sql',import.meta.url),'utf8');
 db.transaction(()=>{
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  if(!db.prepare('SELECT 1 FROM schema_migrations WHERE version=1').get()) {
   db.exec(sql);db.prepare('INSERT INTO schema_migrations VALUES (1,?)').run(new Date().toISOString());
  }
 }).immediate();
}
