import type { Database } from "bun:sqlite";
import { NotFoundError } from "../db/errors";

export type VideoStatus =
  | "uploading"
  | "queued"
  | "processing"
  | "draft"
  | "published"
  | "failed";

export interface VideoRecord {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
  thumbnailStorageKey: string | null;
  status: VideoStatus;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export type CreateVideoRecord = Omit<
  VideoRecord,
  "createdAt" | "updatedAt" | "publishedAt"
> & {
  createdAt?: string;
  updatedAt?: string;
};

export interface UpdateVideoRecord {
  title?: string;
  description?: string;
  category?: string;
  thumbnailStorageKey?: string | null;
}

export interface VideoRepository {
  listPublic(options: {
    query?: string;
    category?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: VideoRecord[]; total: number }>;
  listAdmin(options: {
    status?: VideoStatus;
    page: number;
    pageSize: number;
  }): Promise<{ items: VideoRecord[]; total: number }>;
  findById(id: string): Promise<VideoRecord | null>;
  findPublishedById(id: string): Promise<VideoRecord | null>;
  findPublishedBySlug(slug: string): Promise<VideoRecord | null>;
  create(input: CreateVideoRecord): Promise<VideoRecord>;
  update(id: string, input: UpdateVideoRecord): Promise<VideoRecord>;
  delete(id: string): Promise<void>;
  setStatus(id: string, status: VideoStatus): Promise<VideoRecord>;
  counts(): Promise<{
    total: number;
    published: number;
    draft: number;
    failed: number;
  }>;
}

type DbRow = Record<string, unknown>;

function mapRow(row: DbRow): VideoRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    description: String(row.description),
    category: String(row.category),
    storageKey: String(row.storage_key),
    originalFilename: String(row.original_filename),
    mimeType: String(row.mime_type),
    fileSizeBytes: Number(row.file_size_bytes),
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    videoCodec: row.video_codec == null ? null : String(row.video_codec),
    audioCodec: row.audio_codec == null ? null : String(row.audio_codec),
    bitrate: row.bitrate == null ? null : Number(row.bitrate),
    thumbnailStorageKey:
      row.thumbnail_storage_key == null ? null : String(row.thumbnail_storage_key),
    status: String(row.status) as VideoStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    publishedAt: row.published_at == null ? null : String(row.published_at),
  };
}

// Clamp to a sane range before it reaches the query: SQLite treats
// `LIMIT -1`/`LIMIT 0` as "unlimited"/"none", so an unclamped caller
// supplied value is a real bug class, not a style choice.
function clampPage(page: number): number {
  return Math.max(1, page);
}

function clampPageSize(pageSize: number): number {
  return Math.min(100, Math.max(1, pageSize));
}

export class SqliteVideoRepository implements VideoRepository {
  constructor(private db: Database) {}

  async listPublic({
    query = "",
    category = "all",
    page,
    pageSize,
  }: {
    query?: string;
    category?: string;
    page: number;
    pageSize: number;
  }) {
    const clampedPage = clampPage(page);
    const clampedPageSize = clampPageSize(pageSize);

    const clauses = ["status = 'published'"];
    const params: (string | number)[] = [];
    if (category && category !== "all") {
      clauses.push("LOWER(category) = LOWER(?)");
      params.push(category);
    }
    if (query) {
      clauses.push(
        "(LOWER(title) LIKE LOWER(?) OR LOWER(description) LIKE LOWER(?) OR LOWER(category) LIKE LOWER(?))",
      );
      const q = `%${query}%`;
      params.push(q, q, q);
    }
    const where = clauses.join(" AND ");

    const total = Number(
      (this.db.prepare(`SELECT COUNT(*) AS count FROM videos WHERE ${where}`).get(
        ...params,
      ) as DbRow).count ?? 0,
    );
    const offset = (clampedPage - 1) * clampedPageSize;
    const rows = this.db
      .prepare(
        `SELECT * FROM videos WHERE ${where} ORDER BY published_at DESC, created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, clampedPageSize, offset) as DbRow[];
    return { items: rows.map(mapRow), total };
  }

  async listAdmin({
    status,
    page,
    pageSize,
  }: {
    status?: VideoStatus;
    page: number;
    pageSize: number;
  }) {
    const clampedPage = clampPage(page);
    const clampedPageSize = clampPageSize(pageSize);

    const where = status ? "WHERE status = ?" : "";
    const params: (string | number)[] = status ? [status] : [];
    const total = Number(
      (this.db.prepare(`SELECT COUNT(*) AS count FROM videos ${where}`).get(
        ...params,
      ) as DbRow).count ?? 0,
    );
    const offset = (clampedPage - 1) * clampedPageSize;
    const rows = this.db
      .prepare(`SELECT * FROM videos ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, clampedPageSize, offset) as DbRow[];
    return { items: rows.map(mapRow), total };
  }

  async findById(id: string) {
    const row = this.db.prepare("SELECT * FROM videos WHERE id = ?").get(id) as
      | DbRow
      | null;
    return row ? mapRow(row) : null;
  }

  async findPublishedById(id: string) {
    const row = this.db
      .prepare("SELECT * FROM videos WHERE id = ? AND status = 'published'")
      .get(id) as DbRow | null;
    return row ? mapRow(row) : null;
  }

  async findPublishedBySlug(slug: string) {
    const row = this.db
      .prepare("SELECT * FROM videos WHERE slug = ? AND status = 'published'")
      .get(slug) as DbRow | null;
    return row ? mapRow(row) : null;
  }

  async create(input: CreateVideoRecord) {
    const now = new Date().toISOString();
    const createdAt = input.createdAt ?? now;
    const updatedAt = input.updatedAt ?? now;
    // published_at is derived from status, never caller supplied (AC-9).
    const publishedAt = input.status === "published" ? now : null;

    this.db
      .prepare(`INSERT INTO videos (
      id, slug, title, description, category, storage_key, original_filename, mime_type,
      file_size_bytes, duration_seconds, width, height, video_codec, audio_codec, bitrate,
      thumbnail_storage_key, status, created_at, updated_at, published_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        input.id,
        input.slug,
        input.title,
        input.description,
        input.category,
        input.storageKey,
        input.originalFilename,
        input.mimeType,
        input.fileSizeBytes,
        input.durationSeconds,
        input.width,
        input.height,
        input.videoCodec,
        input.audioCodec,
        input.bitrate,
        input.thumbnailStorageKey,
        input.status,
        createdAt,
        updatedAt,
        publishedAt,
      );
    return (await this.findById(input.id))!;
  }

  async update(id: string, input: UpdateVideoRecord) {
    const current = await this.findById(id);
    if (!current) throw new NotFoundError(`Video not found: ${id}`);

    this.db
      .prepare(
        "UPDATE videos SET title = ?, description = ?, category = ?, thumbnail_storage_key = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        input.title ?? current.title,
        input.description ?? current.description,
        input.category ?? current.category,
        input.thumbnailStorageKey === undefined
          ? current.thumbnailStorageKey
          : input.thumbnailStorageKey,
        new Date().toISOString(),
        id,
      );
    return (await this.findById(id))!;
  }

  async delete(id: string) {
    this.db.prepare("DELETE FROM videos WHERE id = ?").run(id);
  }

  async setStatus(id: string, status: VideoStatus) {
    const current = await this.findById(id);
    if (!current) throw new NotFoundError(`Video not found: ${id}`);

    const publishedAt =
      status === "published" ? (current.publishedAt ?? new Date().toISOString()) : null;
    this.db
      .prepare("UPDATE videos SET status = ?, published_at = ?, updated_at = ? WHERE id = ?")
      .run(status, publishedAt, new Date().toISOString(), id);
    return (await this.findById(id))!;
  }

  async counts() {
    const rows = this.db
      .prepare("SELECT status, COUNT(*) AS count FROM videos GROUP BY status")
      .all() as DbRow[];
    const byStatus = Object.fromEntries(rows.map((r) => [String(r.status), Number(r.count)]));
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    return {
      total,
      published: byStatus.published ?? 0,
      draft: byStatus.draft ?? 0,
      failed: byStatus.failed ?? 0,
    };
  }
}
