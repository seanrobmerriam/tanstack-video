import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database, SQLiteError } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./client";
import { runMigrations } from "./migrate";
import { SessionRepository } from "../repositories/session-repository";
import { SqliteVideoRepository } from "../repositories/video-repository";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "frame-data-layer-"));
  dbPath = join(dir, "test.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeVideo(overrides: Partial<Parameters<SqliteVideoRepository["create"]>[0]> = {}) {
  return {
    id: "v1",
    slug: "hello-v1",
    title: "Hello Frame",
    description: "A test video",
    category: "Programming",
    storageKey: "videos/v1/source.mp4",
    originalFilename: "hello.mp4",
    mimeType: "video/mp4",
    fileSizeBytes: 100,
    durationSeconds: 12,
    width: 1920,
    height: 1080,
    videoCodec: "h264",
    audioCodec: "aac",
    bitrate: 1000,
    thumbnailStorageKey: null,
    status: "draft" as const,
    ...overrides,
  };
}

describe("migrations", () => {
  test("starting against an empty database creates all tables and records version 1 (AC-1)", () => {
    const db = openDatabase(dbPath);
    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain("videos");
    expect(tables).toContain("admin_sessions");
    expect(tables).toContain("schema_migrations");

    const applied = db
      .prepare("SELECT version FROM schema_migrations WHERE version = 1")
      .get();
    expect(applied).not.toBeNull();
    db.close();
  });

  test("running migrations again against an already migrated database is a no-op (AC-2)", () => {
    const db = openDatabase(dbPath);
    runMigrations(db);
    runMigrations(db);

    const rows = db.prepare("SELECT version FROM schema_migrations").all();
    expect(rows.length).toBe(1);
    db.close();
  });

  test("a failing migration leaves the database in its prior state (AC-8)", () => {
    const db = openDatabase(dbPath);
    runMigrations(db);

    expect(() =>
      runMigrations(db, [
        { version: 2, name: "broken", sql: "CREATE TABLE this is not valid sql;" },
      ]),
    ).toThrow();

    const broken = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(broken.sort()).toEqual(["admin_sessions", "schema_migrations", "videos"]);

    const version2 = db
      .prepare("SELECT version FROM schema_migrations WHERE version = 2")
      .get();
    expect(version2).toBeNull();
    db.close();
  });
});

describe("SqliteVideoRepository", () => {
  let db: Database;
  let repo: SqliteVideoRepository;

  beforeEach(() => {
    db = openDatabase(dbPath);
    runMigrations(db);
    repo = new SqliteVideoRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  test("draft videos stay private; publishing changes visibility (AC-3, AC-4, AC-6, AC-9)", async () => {
    await repo.create(makeVideo());

    expect((await repo.listPublic({ page: 1, pageSize: 10 })).total).toBe(0);

    const published = await repo.setStatus("v1", "published");
    expect(published.publishedAt).not.toBeNull();

    const result = await repo.listPublic({
      query: "frame",
      category: "programming",
      page: 1,
      pageSize: 10,
    });
    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe("v1");

    const unpublished = await repo.setStatus("v1", "draft");
    expect(unpublished.publishedAt).toBeNull();
    expect((await repo.listPublic({ page: 1, pageSize: 10 })).total).toBe(0);
  });

  test("the database rejects an invalid status value (AC-7)", () => {
    expect(() =>
      db
        .prepare(
          "INSERT INTO videos (id, slug, title, description, category, storage_key, original_filename, mime_type, file_size_bytes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          "bad",
          "bad-slug",
          "Bad",
          "",
          "cat",
          "videos/bad/source.mp4",
          "bad.mp4",
          "video/mp4",
          1,
          "not-a-real-status",
          "now",
          "now",
        ),
    ).toThrow();
  });

  test("a duplicate slug surfaces as a distinguishable constraint error (AC-10)", async () => {
    await repo.create(makeVideo());

    let caught: unknown;
    try {
      await repo.create(makeVideo({ id: "v2", storageKey: "videos/v2/source.mp4" }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SQLiteError);
    expect((caught as SQLiteError).code).toBe("SQLITE_CONSTRAINT_UNIQUE");
  });

  test("update/findById/setStatus against a missing id raise NotFoundError (AC-10)", async () => {
    await expect(repo.update("missing", { title: "x" })).rejects.toThrow();
    await expect(repo.setStatus("missing", "published")).rejects.toThrow();
    expect(await repo.findById("missing")).toBeNull();
  });
});

describe("SessionRepository", () => {
  let db: Database;
  let repo: SessionRepository;

  beforeEach(() => {
    db = openDatabase(dbPath);
    runMigrations(db);
    repo = new SessionRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  test("session lifecycle stores only hashed tokens (AC-5)", async () => {
    const session = {
      id: "s1",
      tokenHash: "hashed-token",
      csrfTokenHash: "hashed-csrf",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-02T00:00:00.000Z",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
    };
    await repo.create(session);

    const found = await repo.findByTokenHash("hashed-token");
    expect(found?.id).toBe("s1");

    await repo.touch("s1");
    const touched = await repo.findByTokenHash("hashed-token");
    expect(touched?.lastSeenAt).not.toBe(session.lastSeenAt);

    await repo.deleteById("s1");
    expect(await repo.findByTokenHash("hashed-token")).toBeNull();

    const columns = db
      .prepare("PRAGMA table_info(admin_sessions)")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(columns).not.toContain("token");
    expect(columns).not.toContain("plaintext_token");
  });

  test("a duplicate token_hash surfaces as a distinguishable constraint error (AC-10)", async () => {
    const session = {
      id: "s1",
      tokenHash: "dup-hash",
      csrfTokenHash: "csrf-1",
      createdAt: "now",
      expiresAt: "later",
      lastSeenAt: "now",
    };
    await repo.create(session);

    let caught: unknown;
    try {
      await repo.create({ ...session, id: "s2" });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SQLiteError);
    expect((caught as SQLiteError).code).toBe("SQLITE_CONSTRAINT_UNIQUE");
  });
});
