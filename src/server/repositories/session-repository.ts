import type { Database } from "bun:sqlite";

export interface AdminSession {
  id: string;
  tokenHash: string;
  csrfTokenHash: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

type DbRow = Record<string, unknown>;

function mapRow(row: DbRow): AdminSession {
  return {
    id: String(row.id),
    tokenHash: String(row.token_hash),
    csrfTokenHash: String(row.csrf_token_hash),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    lastSeenAt: String(row.last_seen_at),
  };
}

export class SessionRepository {
  constructor(private db: Database) {}

  async create(session: AdminSession): Promise<void> {
    this.db
      .prepare(
        "INSERT INTO admin_sessions (id, token_hash, csrf_token_hash, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        session.id,
        session.tokenHash,
        session.csrfTokenHash,
        session.createdAt,
        session.expiresAt,
        session.lastSeenAt,
      );
  }

  async findByTokenHash(hash: string): Promise<AdminSession | null> {
    const row = this.db
      .prepare("SELECT * FROM admin_sessions WHERE token_hash = ?")
      .get(hash) as DbRow | null;
    return row ? mapRow(row) : null;
  }

  async touch(id: string): Promise<void> {
    this.db
      .prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  }

  async deleteByTokenHash(hash: string): Promise<void> {
    this.db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(hash);
  }

  async deleteById(id: string): Promise<void> {
    this.db.prepare("DELETE FROM admin_sessions WHERE id = ?").run(id);
  }

  async deleteExpired(now: string = new Date().toISOString()): Promise<void> {
    this.db.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").run(now);
  }
}
