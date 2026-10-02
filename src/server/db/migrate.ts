import type { Database } from "bun:sqlite";
import { MIGRATIONS, type Migration } from "./migrations";

function isApplied(db: Database, version: number): boolean {
  const row = db
    .prepare("SELECT version FROM schema_migrations WHERE version = ?")
    .get(version);
  return row != null;
}

// `migrations` defaults to the real ordered list; a test can pass its own
// (e.g. one with deliberately invalid SQL) to exercise the runner in isolation.
export function runMigrations(db: Database, migrations: Migration[] = MIGRATIONS): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  for (const migration of migrations) {
    if (isApplied(db, migration.version)) continue;

    db.exec("BEGIN IMMEDIATE");
    try {
      // Re-check inside the transaction: two overlapping startups could both
      // have seen "not yet applied" before either acquired the write lock.
      if (isApplied(db, migration.version)) {
        db.exec("ROLLBACK");
        continue;
      }

      db.exec(migration.sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, new Date().toISOString());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
