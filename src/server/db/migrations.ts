export interface Migration {
  version: number;
  name: string;
  sql: string;
}

// Ordered list so a future migration 2 only ever appends; never edit an applied entry.
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial",
    sql: `
CREATE TABLE videos (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    storage_key TEXT NOT NULL UNIQUE,
    original_filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    duration_seconds REAL,
    width INTEGER,
    height INTEGER,
    video_codec TEXT,
    audio_codec TEXT,
    bitrate INTEGER,
    thumbnail_storage_key TEXT,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('uploading', 'queued', 'processing', 'draft', 'published', 'failed')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT,
    CHECK ((status = 'published') = (published_at IS NOT NULL))
);
CREATE INDEX videos_category_idx ON videos(category);
CREATE INDEX videos_status_idx ON videos(status);
CREATE INDEX videos_published_at_idx ON videos(published_at);

CREATE TABLE admin_sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_token_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);
CREATE INDEX admin_sessions_expires_at_idx ON admin_sessions(expires_at);
`,
  },
];
