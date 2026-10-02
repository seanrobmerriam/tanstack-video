# 0001. Adopt bun:sqlite with hand rolled migrations for the data layer

**Date**: 2026-10-02
**Status**: Proposed

## Summary

This decides how Frame stores and reads video and admin session data on the new stack. It ports the schema and repository pattern that already work in `videostreamgo` (a Deno Fresh app), swapping only the SQLite driver for Bun's built in one. No ORM, no query builder, no migration framework; the same hand rolled, transparent approach the reference app already proved out. Routes and server functions will never touch SQL directly, only the two repositories this spec defines.

## Context

Frame needs a place to persist video metadata (title, category, storage key, processing status, technical metadata from ffprobe) and admin session data (hashed session and CSRF tokens). The reference implementation, `videostreamgo`, already solved this on Deno with `node:sqlite`'s synchronous `DatabaseSync` API, hand rolled migrations tracked in a `schema_migrations` table, and a repository class per entity (`SqliteVideoRepository`, `SessionRepository`) that is the only code allowed to issue SQL.

This repo runs on a different runtime: TanStack Start deployed through Nitro's `bun` preset, a single Bun server process. `node:sqlite` is a Node API; Bun ships its own native SQLite binding, `bun:sqlite`, with a very similar synchronous shape. The decision is whether to port the existing design as is (swapping only the driver), adopt an ORM or query builder on top, or take on a migration framework. Frame's own product doc is explicit that the project carries no ORM and no external migration tool, and the reference app's `technology.md` states the same constraint, so any option that adds either needs a real justification, not convenience.

The schema also needs one substantive update for this migration: the reference app's `status` enum (`draft`, `published`, `processing`, `failed`) only has two states a single Bun process without a worker queue will ever produce (`draft`, `published`); `processing` and `failed` are already unused reservations for a future async pipeline. Frame's product doc describes a fuller lifecycle (`uploading`, `queued`, `processing`, `draft`, `published`, `failed`) for when that async worker boundary is eventually built (a later, deferred phase of this migration). Deciding now whether to widen the enum avoids a second migration later, at the cost of carrying unused values sooner.

## Requirements

**User stories**:
- As a server function or API route elsewhere in Frame, I want a `VideoRepository` and a `SessionRepository` so I can read and write video and session data without writing SQL myself.
- As the application at startup, I want migrations to apply automatically and exactly once, so a fresh database and a running one both end up with the same schema.
- As an operator, I want video and session data stored in one SQLite file I can back up, with no ORM or migration tool to additionally understand.

**Acceptance criteria**:
- **AC-1**: Starting the app against an empty database creates the `videos`, `admin_sessions`, and `schema_migrations` tables, and records migration version 1 as applied.
- **AC-2**: Starting the app again against an already migrated database is a no op: no error, no duplicate migration, no data loss.
- **AC-3**: `SqliteVideoRepository` supports every method the reference app's `VideoRepository` interface defines (`listPublic`, `listAdmin`, `findById`, `findPublishedById`, `findPublishedBySlug`, `create`, `update`, `delete`, `setStatus`, `counts`), with the same filtering, pagination, and ordering behavior.
- **AC-4**: `listPublic` only ever returns rows with `status = 'published'`; no code path outside the repository can bypass that filter.
- **AC-5**: `SessionRepository` supports `create`, `findByTokenHash`, `touch`, `deleteByTokenHash`, `deleteById`, and `deleteExpired`, storing only hashed tokens, never plaintext.
- **AC-6**: `setStatus('published', ...)` sets `published_at` if it was previously null, and leaves it untouched if the video was already published; setting any other status clears `published_at` to null.
- **AC-7**: The `status` column accepts `uploading`, `queued`, `processing`, `draft`, `published`, `failed` and rejects any other value at the database level (a `CHECK` constraint, not just application validation).
- **AC-8**: A failed migration (e.g. a syntax error partway through) leaves the database in its prior state, not a half applied one.
- **AC-9**: `published_at` is non null if and only if `status = 'published'`, enforced by the database, not just by application code; `create` ignores any caller supplied `published_at` and derives it from the caller supplied `status`.
- **AC-10**: A duplicate `slug` or `storage_key` on `create`, or a duplicate `token_hash` on session `create`, surfaces as a distinguishable constraint error, not a generic failure; a `findById`/`update`/`setStatus` call against a missing video surfaces as a distinguishable not found error.

## Options considered

### Option 1: bun:sqlite, no ORM

Bun's built in, native SQLite binding. Synchronous `Database` class with `.query()`/`.prepare()`, `.run()`, `.get()`, `.all()`, a close match to `node:sqlite`'s shape. The existing repository code ports with mostly mechanical changes (import path, class name, minor API differences).

**Pros**:
- Zero new dependencies; it ships with the Bun runtime Nitro's `bun` preset already uses.
- Matches Frame's own stated rule (and the reference app's) of no ORM, no query builder.
- Fast: it is a native binding, not a WASM or pure JS SQLite implementation.

**Cons**:
- No schema migration tooling beyond what we hand write; every future schema change is a manually written migration, same as today.

### Option 2: node:sqlite via Bun's Node compatibility layer

Bun implements much of the `node:sqlite` API for compatibility. Keep the existing `node:sqlite` import and `DatabaseSync` class unchanged.

**Pros**:
- Smallest possible code diff from the reference app; literally the same import.

**Cons**:
- Running on a compatibility shim rather than Bun's native, first class SQLite binding is the less proven path on this runtime; any gap in the shim's coverage becomes a debugging problem with less community precedent than `bun:sqlite` itself.
- No actual benefit over Option 1 once the handful of API differences are ported; Option 1 is the more native, better supported choice for the same effort.

### Option 3: Drizzle ORM over bun:sqlite

A typed schema and query builder with a migration generator (`drizzle-kit`), using `bun:sqlite` as its driver underneath.

**Pros**:
- Generates migrations from a schema definition instead of hand writing SQL; type safe query building.

**Cons**:
- A new dependency and a new abstraction layer for a two table schema that is already fully specified; the generated SQL is one more thing to verify rather than read directly.
- Directly contradicts Frame's own documented constraint of no ORM, no query builder, carried over from the reference app for a stated reason (one obvious way to do something, transparent SQL).

## Decision

**Chosen option**: Option 1: bun:sqlite, no ORM

Port the schema and repository pattern from `videostreamgo` onto `bun:sqlite`, keeping hand rolled migrations and the `schema_migrations` tracking table exactly as the reference app does it, widening the `status` enum to the full six value lifecycle now.

## Rationale

Option 1 wins on every force in Context: it needs no new dependency, it is the native (not compatibility shimmed) binding for this runtime, and it keeps faith with the one explicit architectural constraint both Frame's product doc and the reference app state outright, no ORM. Option 2 would make the initial port marginally smaller but trades a mature, first party binding for a compatibility shim with no offsetting benefit once the few real API differences are handled. Option 3 solves a problem this schema does not have: two tables, no complex relationships, a migration that already exists and works. Introducing Drizzle here would be exactly the kind of tooling sprawl Frame's own rules call out as the failure mode to avoid.

Widening the status enum now (rather than when the async worker phase actually lands) costs nothing operationally, since the inline processing phase never sets anything but `draft`/`published` anyway. It is worth more than "avoiding a second migration" suggests: SQLite cannot `ALTER` a `CHECK` constraint, so adding these values later means rebuilding the whole `videos` table (create new, copy every row, drop, rename), not a simple additive migration. That said, the async worker phase will likely need more than a wider enum, for example columns to track a processing error message or attempt count, so this decision narrows but does not eliminate that later phase's own migration.

## Feature design

**Data model sketch**:

`videos`
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | TEXT | no | primary key, uuid |
| slug | TEXT | no | unique |
| title | TEXT | no | |
| description | TEXT | no | default `''` |
| category | TEXT | no | |
| storage_key | TEXT | no | unique, portable key, not a filesystem path |
| original_filename | TEXT | no | |
| mime_type | TEXT | no | |
| file_size_bytes | INTEGER | no | |
| duration_seconds | REAL | yes | from ffprobe |
| width, height | INTEGER | yes | from ffprobe |
| video_codec, audio_codec | TEXT | yes | from ffprobe |
| bitrate | INTEGER | yes | from ffprobe |
| thumbnail_storage_key | TEXT | yes | |
| status | TEXT | no | `CHECK IN ('uploading','queued','processing','draft','published','failed')`, default `'draft'` |
| created_at, updated_at | TEXT | no | ISO 8601 |
| published_at | TEXT | yes | null unless `status = 'published'`, enforced by a table level `CHECK ((status = 'published') = (published_at IS NOT NULL))` (AC-9) |

Indexes: `category`, `status`, `published_at`.

The TypeScript `VideoStatus` type widens to all six values (`'uploading' | 'queued' | 'processing' | 'draft' | 'published' | 'failed'`), so `listAdmin` and `setStatus` can express every status the database now accepts. `counts()` keeps its `{ total, published, draft, failed }` shape; `total` is the count across all six statuses (so it can exceed `published + draft + failed` once a row exists in `uploading`/`queued`/`processing`, none of which this phase ever creates).

`admin_sessions`
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | TEXT | no | primary key |
| token_hash | TEXT | no | unique, hashed session token |
| csrf_token_hash | TEXT | no | hashed CSRF token |
| created_at, expires_at, last_seen_at | TEXT | no | ISO 8601 |

Index: `expires_at`. No foreign key between the two tables; single admin, no users table.

**State transitions**:

This phase (inline processing, no worker queue) only ever produces and reads `draft` and `published`:
```
draft → published (publish)
published → draft (unpublish)
```
`uploading`, `queued`, `processing`, `failed` are schema reserved for the deferred async worker phase; no code in this phase writes them.

**API surface** (this is a backend data layer, not an HTTP surface; the "endpoints" are the two repository interfaces every other feature calls):

| Interface | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| VideoRepository | listPublic | query?, category?, page, pageSize | items, total | n/a (filters to published) | none (empty list on no match) |
| VideoRepository | listAdmin | status?, page, pageSize | items, total | n/a (caller enforces admin) | none |
| VideoRepository | findById / findPublishedById / findPublishedBySlug | id or slug | VideoRecord or null | n/a | none |
| VideoRepository | create | CreateVideoRecord | VideoRecord | n/a | `SQLiteError` (`code: 'SQLITE_CONSTRAINT_UNIQUE'`) on a duplicate slug or storage_key |
| VideoRepository | update | id, UpdateVideoRecord | VideoRecord | n/a | `NotFoundError` if `id` doesn't exist |
| VideoRepository | delete | id | void | n/a | none (no-op if missing) |
| VideoRepository | setStatus | id, status | VideoRecord | n/a | `NotFoundError` if `id` doesn't exist |
| VideoRepository | counts | — | total/published/draft/failed counts | n/a | none |
| SessionRepository | create | AdminSession | void | n/a | `SQLiteError` (`code: 'SQLITE_CONSTRAINT_UNIQUE'`) on a duplicate token_hash |
| SessionRepository | findByTokenHash | hash | AdminSession or null | n/a | none |
| SessionRepository | touch / deleteByTokenHash / deleteById / deleteExpired | id or hash or none | void | n/a | none |

The repository layer does no authorization itself (see Security model); `listPublic` enforces the published filter unconditionally, everything else trusts its caller.

Exact behavior this port preserves, named explicitly rather than left as "same as the reference app" (closes AC-3):
- `listPublic` search (`query`) is a case insensitive `LIKE` over `title`, `description`, and `category`. `%` and `_` in the search text are not escaped (matching the reference app); a visitor's own search can match more broadly than they intend, but it is their own query, not a security issue.
- `category` filtering is case insensitive; `'all'` or an empty string means no category filter, same as the reference app.
- `page` is 1 based; a value below 1 is clamped to 1 by the repository.
- `pageSize` is clamped by the repository to a sane range, 1 to 100, before it reaches the query (SQLite treats `LIMIT -1`/`LIMIT 0` as "unlimited"/"none", so an unclamped caller supplied value is a real bug class, not a style choice).
- `listPublic` orders by `published_at DESC, created_at DESC`; `listAdmin` orders by `created_at DESC`.
- `update`'s patchable fields are exactly `title`, `description`, `category`, `thumbnailStorageKey`; a field left `undefined` keeps its current value, `thumbnailStorageKey: null` explicitly clears it.
- Every repository method keeps the reference app's synchronous-under-the-hood, `Promise`-returning signature (interface parity with the reference app; nothing here becomes genuinely async).

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| create | id | caller supplied or generated by the caller (the upload flow feature, not this layer) |
| create | slug | caller supplied (derived from title + id by the upload flow feature) |
| create | created_at, updated_at | `new Date().toISOString()` at write time, defaulted inside the repository if not supplied |
| create | status | caller supplied, defaults to `'draft'` at the database level |
| create | published_at | derived by the repository from the caller supplied `status`: now if `status = 'published'`, else null; any caller supplied `published_at` is ignored (AC-9) |
| update | updated_at | `new Date().toISOString()` at write time |
| setStatus('published') | published_at, updated_at | published_at set to now if currently null, else left unchanged (AC-6); updated_at always set to now |
| setStatus(any other) | published_at, updated_at | published_at set to null; updated_at always set to now |
| update | fields not supplied | fall back to the current row's value (partial update) |
| migrations | applied_at | `new Date().toISOString()` at migration run time |
| SessionRepository.create | created_at, expires_at, last_seen_at | caller supplied; the session lifetime (how far in the future `expires_at` is) is owned by the Admin auth & sessions feature, not this layer |
| SessionRepository.touch | last_seen_at | `new Date().toISOString()` at write time |
| SessionRepository.deleteExpired | the comparison time | an optional `now` parameter, defaulting to `new Date().toISOString()` if the caller omits it (matches the reference app) |

**Key invariants**:
- `slug` and `storage_key` are each unique across all videos.
- `status` is always one of the six enumerated values (enforced by `CHECK`, not just application code).
- `published_at` is non null if and only if `status = 'published'` (enforced by a database `CHECK`, not just application code; AC-9).
- `admin_sessions.token_hash` is unique; no plaintext token or password is ever written to either table.
- Migrations run inside a transaction; a failure rolls back fully (AC-8).
- The singleton module (see Build plan, task 6) exports only the two repositories, never the raw `Database` handle; nothing outside this layer can open a connection or issue SQL directly (this is what actually makes AC-4 and "routes never touch SQL" enforceable, not just conventional).

**Security model**: This layer stores only hashed session and CSRF tokens; hashing itself is the Admin auth & sessions foundation's responsibility, not this one. The repository does not authorize callers: `listPublic` always filters to `published` regardless of caller, but `listAdmin` and the by id lookups trust whoever calls them to have already checked the caller is an authenticated admin. No compliance scope applies (no payment or health data).

**Configuration required**:
- `DATABASE_PATH`: filesystem path to the SQLite database file; defaults to `./data/app.db` if unset, same as the reference app. A relative path resolves against the repo root, not whatever working directory Nitro's built server happens to start from; the client resolves it explicitly rather than trusting `process.cwd()`.

**Runtime notes** (the gaps a Bun specific driver raises that the reference app, on a single runtime throughout, never had to answer):
- `bun:sqlite` only exists under the Bun runtime. The dev server must run as `bun --bun vite dev` (or the project's equivalent script), not plain `vite dev` under Node; this is a one line note in the project's dev script/`package.json`, not a design decision this spec needs to revisit later.
- Both the Vite dev build and the Nitro production build must keep `bun:sqlite` as an external import, never bundled.
- The singleton (Build plan, task 6) caches its database handle on `globalThis` under a module specific key, so a dev server hot reload re-uses the existing connection instead of opening a new file handle on every reload.
- The client creates `DATABASE_PATH`'s parent directory (`mkdir -p` equivalent) before opening the database; Bun's `Database` does not create missing directories itself.
- The client sets `PRAGMA busy_timeout = 5000` in addition to `foreign_keys` and `journal_mode = WAL`, so a brief lock contention (another process holding a backup lock, an overlapping migration check) waits briefly instead of failing immediately with `SQLITE_BUSY`.
- The migration runner re-checks `schema_migrations` for the pending version after acquiring `BEGIN IMMEDIATE`, not only before, closing the small window where two overlapping startups could both see "not yet applied".
- Backups must not copy `app.db` alone while the app is running: in WAL mode, recent commits can live in `app.db-wal` and a plain file copy can miss them. The operator facing backup instructions (README, not this spec) should use `VACUUM INTO` or an equivalent online backup method, not a raw file copy.

**Critical test scenarios**:
- Happy path: create a video record, find it by id, publish it, confirm `published_at` is set and `listPublic` now returns it, verifies **AC-3**, **AC-4**, **AC-6**, **AC-9**.
- Failure case: run migrations twice against the same database file; the second run is a no op with no error and no duplicate rows in `schema_migrations`, verifies **AC-2**.
- Failure case: attempt to insert a video with an invalid status value; the database rejects it via the `CHECK` constraint, verifies **AC-7**.
- Failure case: inject a migration with invalid SQL into the runner's migration list and confirm no table exists afterward and no row was written to `schema_migrations`, verifies **AC-8**.
- Failure case: create two videos with the same `slug`; the second `create` throws an `SQLiteError` with `code: 'SQLITE_CONSTRAINT_UNIQUE'`, verifies **AC-10**.
- Session lifecycle: create a session, find it by token hash, touch it, delete it by id, confirm each step only ever stores the hash never a plaintext token, verifies **AC-5**.
- Auth/permission: n/a at this layer (no authorization happens here; covered by the Admin auth & sessions feature).

## Build plan

1. Write the migration module as an ordered list of `{ version, name, sql }` entries (not a single hardcoded migration), starting with migration 1 (schema for `videos` with the six value status enum and its `published_at` `CHECK`, `admin_sessions`, both indexes); the ordered list shape is what migration 2 will need later, so it is built in now rather than retrofitted, satisfies **AC-1**, **AC-7**, **AC-9**
2. Implement the database client: create `DATABASE_PATH`'s parent directory if missing, open a `bun:sqlite` `Database`, set `PRAGMA foreign_keys = ON`, `PRAGMA journal_mode = WAL`, and `PRAGMA busy_timeout = 5000`, satisfies **AC-1**
3. Implement the migration runner over the ordered list: create `schema_migrations` if missing, for each pending version re-check inside `BEGIN IMMEDIATE` that it is still unapplied, then apply it and record it, rolling back on any error, satisfies **AC-1**, **AC-2**, **AC-8**
4. Define a `NotFoundError` and document that a unique constraint violation surfaces as `bun:sqlite`'s `SQLiteError` with `code: 'SQLITE_CONSTRAINT_UNIQUE'`, satisfies **AC-10**
5. Implement `SqliteVideoRepository` with every method from the reference app's interface, the exact search/pagination/ordering/patch semantics named in Feature design, and `published_at` derived rather than caller supplied on `create`, satisfies **AC-3**, **AC-4**, **AC-6**, **AC-9**, **AC-10**
6. Implement `SessionRepository` with every method from the reference app's interface, satisfies **AC-5**, **AC-10**
7. Wire a server only singleton module that opens the database, runs migrations once at import time, caches its handle on `globalThis` to survive dev reloads, and exports only the two repositories, never the raw `Database`, satisfies **AC-1**, **AC-2**, **AC-4**
8. Confirm the dev and build scripts run under Bun (`bun --bun vite dev` or equivalent) and that `bun:sqlite` stays external in both the Vite and Nitro build configs
9. Exercise the critical test scenarios above against a real SQLite file (a throwaway one, not the dev database) to confirm the migration and both repositories behave as specified, satisfies **AC-1** through **AC-10**

## Consequences

**Positive**:
- No new dependency; the data layer ships with what Nitro's `bun` preset already provides.
- The schema's status lifecycle is ready for the deferred async worker phase without rebuilding the `videos` table later (though that phase will likely still add its own columns, e.g. an error message or attempt count).
- Every other feature gets a stable, narrow interface (two repositories) instead of touching SQL.

**Negative / tradeoffs**:
- Hand rolled migrations mean every future schema change is a manually written SQL string, with no generator to catch a typo before runtime.
- The widened status enum carries three values (`uploading`, `queued`, and the already present but unused `processing`) that nothing produces or reads until the deferred async worker phase is built; a reader of the schema today has to know that, and `counts()`'s `total` can exceed the sum of its named buckets once a row exists in one of them.
- `bun:sqlite` ties the dev server and both build configs to actually running under Bun; this was implicit before (Nitro's `bun` preset already requires it) but this driver choice makes a mismatch fail loudly and immediately instead of silently.

**Neutral**:
- The repository API shape is unchanged from the reference app; a developer who knows `videostreamgo`'s data layer already knows this one.

## Follow-up

- [ ] No root `AGENTS.md` exists yet in this repo; `/audit` should run at some point so later features don't each have to re-derive stack facts from the scaffold and the scope.
- [ ] The async worker boundary (deferred in `docs/scope/scope.md`) will need its own spec when that phase starts; it is the reason `uploading`/`queued` exist in the schema today with nothing producing them yet.
