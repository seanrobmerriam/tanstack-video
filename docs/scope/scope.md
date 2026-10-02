# Scope: Frame

A minimal, high performance video on demand platform: upload video, store it, process it asynchronously, manage its metadata, publish it, deliver it efficiently. This pass migrates the working reference implementation (`videostreamgo`, Deno Fresh) onto this repo's stack, TanStack Start plus Solid.

**Build approach:** Tracer Bullet (each feature built end to end through every layer, data to UI, before moving to the next, so the new stack proves it can carry this architecture one slice at a time).
**Workflow:** Alpha (after `/develop`, `/check verify` on the real running app; no mandatory test suite or second review unless a feature calls for it). Admin auth & sessions carries its own `· GA` tag since it is security sensitive. `/architect` is the recommended first stop for a feature marked "needs a decision", skippable when you already know the build. You decide when a feature is `done`.

_These are recommendations to keep the migration orderly, not requirements. Skip anything that does not fit._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | Project scaffold & tooling | Foundation | existing |
| 2 | Data layer | Foundation | planned |
| 3 | Storage abstraction | Foundation | planned |
| 4 | Media processing boundary | Foundation | planned |
| 5 | Admin auth & sessions | Foundation | planned |
| 6 | Public video catalog | Slice 1 | planned |
| 7 | Video player & byte range streaming | Slice 1 | planned |
| 8 | Admin login | Slice 2 | planned |
| 9 | Video upload flow | Slice 3 | planned |
| 10 | Admin video list & metadata edit | Slice 3 | planned |
| 11 | Publish, unpublish, delete | Slice 3 | planned |
| 12 | Thumbnail management | Slice 3 | planned |

## Foundations

### 1. Project scaffold & tooling · existing
TanStack Start + Solid, Biome, Nitro, no demo pages. Scaffolded and building clean.
code in `./` (PR #1)

### 2. Data layer · needs a decision
Port the `videos` and `admin_sessions` schema and the repository pattern (`SqliteVideoRepository`, `SessionRepository`) from `videostreamgo`'s `node:sqlite` + hand rolled migrations onto this stack's runtime (Nitro's `bun` preset). Routes and services must never touch SQL directly.
**Done when:** the schema from `db/migrations/001_initial.ts` is ported, migrations run at startup and are tracked in `schema_migrations`, and both repositories pass the same behavior as the source app's tests.
- [ ] Design it (spec): `/architect data layer`

### 3. Storage abstraction · needs a decision
Port the `VideoStorage` interface and `LocalVideoStorage`: writes under a configurable root, portable storage keys (`videos/<uuid>/source.mp4`) persisted in SQLite instead of paths. Decide how reads (currently `resolveLocalPath` called directly by the playback and thumbnail routes) stay behind the boundary on this stack.
**Done when:** `putVideo`, `putThumbnail`, `delete`, and byte range reads all go through the storage boundary, and no route holds a raw filesystem path.
- [ ] Design it (spec): `/architect storage abstraction`

### 4. Media processing boundary · needs a decision
Port `ffprobe` based metadata extraction and `ffmpeg` thumbnail generation. Per the project's standing decision, this stays inline in the request path for this migration (parity first); the async queue and external worker split Frame's product doc calls for is deferred (see Deferred).
**Done when:** probing and thumbnailing run against an uploaded file the same way the source app does (duration, resolution, codecs, bitrate; a 640px JPEG at 20% duration capped at 30s), and a thumbnail failure never fails the upload.
- [ ] Design it (spec): `/architect media processing boundary`

### 5. Admin auth & sessions · needs a decision · GA
Port single admin PBKDF2 password auth, hashed session tokens, hashed CSRF tokens, and cookie handling onto TanStack Start's session/cookie primitives.
**Done when:** an admin can sign in, a session survives a reload, CSRF is validated on every admin mutation, and no secret or token is ever stored or logged in plaintext.
- [ ] Design it (spec): `/architect admin auth & sessions`

## Slice 1: Public catalog & playback

### 6. Public video catalog · needs a decision
The public landing page: published videos, category navigation, search, pagination. First UI feature, establishes `design.md` per Frame's "dense developer tool" interface direction (small type, tight spacing, monospace paths, color only when it means something, nothing moves unless clicked).
**Done when:** only published videos are visible, search and category filters work, pagination does not load the whole library into the browser, and the design system is recorded.
- [ ] Design it (spec): `/architect public video catalog`

### 7. Video player & byte range streaming · needs a decision
The `/media/videos/:id` equivalent: serves bytes for published videos only, correct `206 Partial Content` and `Range` handling for seeking, correct `HEAD` and cache behavior. Kept outside any static file serving so unpublished videos can never leak through it.
**Done when:** a known MP4 streams with correct partial content responses, seeking in the browser produces Range requests instead of re-downloading the file, and an unpublished or missing video never serves bytes.
- [ ] Design it (spec): `/architect video player & byte range streaming`

## Slice 2: Admin access

### 8. Admin login
The sign in screen, wired to the Admin auth & sessions foundation and the design system from the catalog slice.
**Done when:** a wrong password is rejected with no information leak, a correct one starts a session, and an existing session skips the form.
- [ ] Build it: `/develop admin login`

## Slice 3: Video management

### 9. Video upload flow · needs a decision
Port the two step upload: small editorial metadata staged in memory (30 minute TTL), then the browser streams the raw video body directly (not `formData()`) so byte level progress can be shown, landing as a `draft` row once probing and thumbnailing finish.
**Done when:** a large upload returns control to the admin without waiting on probing or thumbnailing to finish, upload progress is visible, and a failed probe or thumbnail does not corrupt or lose the staged upload.
- [ ] Design it (spec): `/architect video upload flow`

### 10. Admin video list & metadata edit
The admin dashboard: list every video regardless of status, edit editorial metadata (title, description, category).
**Done when:** the list shows status for every video including queued and failed states, and an edit saves without touching storage or processing state.
- [ ] Build it: `/develop admin video list & metadata edit`

### 11. Publish, unpublish, delete
State transitions and safe deletion. Deletion order matters: removing metadata before media can orphan storage, removing media first can leave a published record pointing at nothing.
**Done when:** publish and unpublish immediately change what the public catalog and player show, and deleting a video removes its own media without touching another video's objects, with a defined, recoverable order.
- [ ] Build it: `/develop publish, unpublish, delete`

### 12. Thumbnail management
Manual thumbnail regeneration and replacement, reusing the upload flow's storage and processing patterns.
**Done when:** an admin can trigger regeneration or upload a replacement thumbnail without touching the source video or its processing state.
- [ ] Build it: `/develop thumbnail management`

## Deferred
Out of scope for this migration pass, kept so the plan stays honest. Frame's product doc treats these as real but later needs.
- **Async queue & external worker boundary**: move probing/transcoding/thumbnailing off the request path behind a queue contract, per Frame's standing architecture rule · needs a decision
- **S3 compatible object storage backend**: a second `VideoStorage` implementation behind the existing boundary · needs a decision
- **Remote video import (yt-dlp)**: funnels through the same upload/publish/cleanup logic as a direct upload · needs a decision
- **Health checks & operational visibility**: enough signal to know storage or processing is broken · needs a decision

## Legend

**The decision box.** Every feature carries exactly one, the sub-task whose label ends with `(spec)`. Every other box is an execution box.

**Feature lifecycle:**

| State | Set by | The feature shows |
|---|---|---|
| `planned` · needs a decision | `/scope` | one box: `Design it (spec): /architect <feature>` |
| `in-progress` (designed) | `/architect` at spec capture | `Design it` ticked; spec linked; `Build it: /develop <feature>` + 2 to 5 milestones; `Verify it: /check verify <feature>` (Alpha tier) |
| `in-progress` (building) | `/develop` | milestone sub-boxes tick one by one; code pointer filled |
| `in-progress` (verified) | `/check verify` | `Build it` + milestones ticked; `Verify it` ticked |
| `done` | you, when you decide it is; `/sync` reconciles | boxes you ran ticked, skipped ones marked skipped |

- **Next step** = the first unticked box.
- **needs a decision** = run `/architect` first; otherwise straight to `/develop`. The tag drops once the spec is captured.
- **Status**: `planned` → `in-progress` → `done`, plus `existing` (pre-workflow, here the scaffold) and `dropped` (de-scoped, kept for history).
- **Workflow tier tag** (e.g. `· GA`) sets that one feature's rigor above the project default (Alpha); no tag inherits it.
- **Pointer line** (`spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.
