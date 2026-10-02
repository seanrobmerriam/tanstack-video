import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "bun:sqlite";
import { openDatabase } from "./client";
import { runMigrations } from "./migrate";
import { SessionRepository } from "../repositories/session-repository";
import { SqliteVideoRepository } from "../repositories/video-repository";

// Walk up from this file to the nearest ancestor with a package.json, rather
// than trusting process.cwd() (which Nitro's built server does not control).
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

const REPO_ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

function resolveDatabasePath(): string {
  const configured = process.env.DATABASE_PATH ?? "./data/app.db";
  if (configured === ":memory:" || isAbsolute(configured)) return configured;
  return join(REPO_ROOT, configured);
}

interface DataLayerSingleton {
  db: Database;
  videoRepository: SqliteVideoRepository;
  sessionRepository: SessionRepository;
}

const globalKey = "__frame_data_layer__";
const globalForDataLayer = globalThis as unknown as {
  [globalKey]?: DataLayerSingleton;
};

function createSingleton(): DataLayerSingleton {
  const db = openDatabase(resolveDatabasePath());
  runMigrations(db);
  return {
    db,
    videoRepository: new SqliteVideoRepository(db),
    sessionRepository: new SessionRepository(db),
  };
}

// Cached on globalThis so a dev server hot reload reuses the existing
// connection instead of opening a new file handle on every reload.
const singleton = (globalForDataLayer[globalKey] ??= createSingleton());

export const videoRepository: SqliteVideoRepository = singleton.videoRepository;
export const sessionRepository: SessionRepository = singleton.sessionRepository;
