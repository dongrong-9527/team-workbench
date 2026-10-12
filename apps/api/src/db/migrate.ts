import type { Database } from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";

export function migrate(db: Database): void {
  const directory = new URL("../../migrations/", import.meta.url);
  const files = readdirSync(directory)
    .filter((name) => /^\d{3}_[a-z_]+\.sql$/.test(name))
    .sort();
  db.transaction(() => {
    db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    for (const file of files) {
      const version = Number(file.slice(0, 3));
      if (
        !db
          .prepare("SELECT 1 FROM schema_migrations WHERE version=?")
          .get(version)
      ) {
        db.exec(readFileSync(new URL(file, directory), "utf8"));
        db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(
          version,
          new Date().toISOString(),
        );
      }
    }
  }).immediate();
}
