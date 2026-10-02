# Frame

The product decisions behind Frame, written before the platform grows around them. The reasoning matters more than any individual implementation choice — this project will hit forks that are not covered here, and the point of this document is to make the intended direction explicit.

Read the part you need before changing a subsystem. Do not treat this as a feature checklist. It is a constraint document for deciding what belongs in Frame, what does not, and why.

## What it is

Frame is a minimal, high-performance video-on-demand and streaming platform.

The product is intentionally narrow: upload video, store it, process it asynchronously, manage its metadata, publish it, and deliver it efficiently.

The web application should remain small and fast. Media processing should happen outside the request path. Storage should be replaceable. The platform should expose enough seams that users can extend it without turning the core into a kitchen-sink video product.

Frame is not a social network, creator economy platform, recommendation engine, ad system, or video SaaS clone.

The core idea is simpler:

> Frame manages video. Workers process video. Storage delivers video.

That separation is the product.

## The problem

Most video platforms grow sideways.

A team starts with a straightforward need — host and play video — and quickly inherits a much larger system: accounts, feeds, reactions, recommendations, creator profiles, billing, analytics, social graphs, chat, DRM, organizations, roles, ad systems, moderation pipelines, and product decisions that have nothing to do with reliable video delivery.

That is reasonable for products that need those features. It is unnecessary overhead for everyone else.

At the other end of the spectrum, a raw object store plus FFmpeg scripts gives full control but leaves every application team to rebuild the same essentials: ingest, metadata, transcoding state, playback URLs, admin workflows, search, thumbnails, and delivery semantics.

Frame exists between those two extremes.

It provides the smallest coherent video platform that is still useful as a product, while keeping nonessential behavior outside the core.

The problem is not that video infrastructure is impossible to assemble. The problem is that assembling it usually forces a choice between too much platform and too little product.

Frame is the middle layer.

## Who it's for

A developer or small engineering team that needs a real video platform but does not want to adopt somebody else's product model.

Typical users include:

- teams building private video libraries
- internal training or knowledge platforms
- education products
- membership products
- media archives
- custom VOD products
- developer-facing video systems
- self-hosted deployments that need control over storage and processing

They are comfortable owning infrastructure.

They do not need Frame to decide how their business works.

They need a fast, understandable foundation for video.

This description is the test every feature gets measured against. When a proposed feature appears — comments, recommendations, subscriptions, engagement metrics, creator profiles — the question is whether the user above needs that feature in the core platform.

Usually they do not.

## Why this hasn't stuck before

Minimal video hosting is not a new idea.

There are already media servers, self-hosted streaming tools, hosted video APIs, object-storage workflows, FFmpeg wrappers, and full video platforms.

The failure mode is usually one of two things.

The first is product creep. A video server becomes a media center. A VOD system becomes a creator platform. An administration interface becomes a dashboard product. Every adjacent feature is individually reasonable and collectively destroys the simplicity that made the system attractive.

The second is infrastructure leakage. A project stays technically minimal but makes the application developer own every low-level concern directly: local paths, FFmpeg command construction, object storage details, background execution, retries, and provider-specific behavior.

Frame is betting that there is value in staying between those two outcomes.

It should feel complete at the video-management layer while remaining deliberately incomplete at the business-product layer.

That is the bet. It should remain visible as a bet rather than quietly turning into a roadmap for becoming a larger platform.

## The rule everything rests on

**The web application must stay out of the expensive media path.**

Uploads may originate from the application, but transcoding, probing, thumbnail generation, imports, and other CPU-heavy processing should not block normal web requests.

The Fresh application should be responsible for lightweight coordination:

- metadata
- administration
- authentication
- publishing state
- search
- pagination
- queue publication
- playback URL generation
- rendering

Workers should handle:

- FFmpeg
- FFprobe
- transcoding
- thumbnail generation
- expensive media inspection
- remote imports
- derivative generation

Storage should handle bytes.

The reason is architectural, not aesthetic.

Once the web process becomes responsible for media processing, upload latency, worker latency, playback, and page rendering become coupled. A large transcode can now degrade unrelated requests. Scaling the web tier means scaling FFmpeg. A failure in media tooling becomes a failure in the user-facing application.

Frame refuses that coupling.

Pressure to break this rule will come from convenience: "just run FFmpeg here," "just generate the thumbnail during upload," "just wait for processing before returning." Those shortcuts are acceptable in experiments and should not become the production architecture.

## Scope

- A fast public video catalog.
- Individual video pages.
- Search.
- Categories.
- Pagination.
- Administrative authentication.
- Upload workflows.
- Draft and published states.
- Edit video metadata.
- Publish and unpublish.
- Delete video.
- Thumbnail management.
- FFprobe-based technical metadata extraction.
- HTTP Range playback.
- Correct partial-content behavior.
- Cache-friendly media responses.
- Local filesystem storage.
- S3-compatible object storage.
- Portable storage keys rather than hard-coded absolute paths.
- Asynchronous queue-driven processing.
- External FFmpeg workers or jobs.
- Processing states such as uploading, queued, processing, draft, published, and failed.
- Stable storage, processing, and repository interfaces.
- Health checks and enough operational visibility to know when storage or processing is broken.
- A small extension surface for features that do not belong in core.

The current reference deployment uses Deno Fresh for the web application, SQLite for local metadata, S3-compatible object storage, a message queue, and external FFmpeg jobs. The architecture should not require those exact vendors to remain valid.

## Out of scope, and why

Each of these is something a model, contributor, or future roadmap discussion will propose because each sounds like a natural improvement. The reason for excluding it matters more than the exclusion itself.

- **Comments, likes, dislikes, followers, and social feeds.** These turn a video platform into a social product. They impose moderation, identity, notification, ranking, and abuse-management requirements that are unrelated to VOD delivery.

- **Recommendation algorithms.** Recommendations are product-specific behavior. A training platform, private archive, streaming service, and membership site do not want the same recommendation system.

- **Creator profiles and channels.** These assume a creator-centric information architecture that many Frame deployments will not have.

- **Advertising and monetization.** Billing and monetization are application concerns. Frame should expose enough hooks that they can be added without making them universal dependencies.

- **Built-in subscriptions and payments.** Same reason. A payment model is not part of video infrastructure.

- **Complex organization and RBAC systems.** The default admin path should stay small. Deployments that need enterprise identity can add it through an authentication boundary rather than forcing every installation to carry it.

- **Chat and social notifications.** They create real-time infrastructure for a use case unrelated to video delivery.

- **DRM in core.** DRM is operationally and commercially specific, provider-dependent, and significantly changes the delivery architecture. It can be an extension when required.

- **Mandatory HLS.** Progressive MP4 with correct Range support is sufficient for many deployments and is operationally simpler. HLS belongs when adaptive bitrate or network conditions justify the additional processing and storage.

- **Mandatory transcoding ladders.** Every uploaded video should not automatically produce a fleet of renditions. Processing should be driven by actual playback requirements.

- **Provider-specific storage assumptions.** Scaleway, AWS, Cloudflare, MinIO, RustFS, and other S3-compatible systems should fit behind the same storage boundary where practical.

- **Running FFmpeg in the Fresh request path.** This violates the central architecture even if it is convenient.

## How it works

No folder names here are mandatory. These are constraints on behavior.

**The web application is an orchestrator, not a media worker.** It creates and updates metadata, accepts or coordinates uploads, publishes work, renders pages, and serves playback information. It should remain responsive while processing happens elsewhere.

**Storage is addressed by keys, not machine paths.** A database record should know that a source lives at something like `watch/<video-id>/source.mp4`, not `/srv/frame/data/whatever/source.mp4`. A storage adapter decides what that key means.

**The source is treated as a durable asset.** Uploading and transcoding are separate operations. A transcode failure does not mean the source upload failed.

**Processing is asynchronous.** A successful upload should be able to transition to `queued` and return control to the user. The processing system moves it to `processing`, then to a ready state or `failed`.

**The queue message is a contract.** It should contain the minimum stable information required to process the asset, preferably a video identifier and/or storage key. The worker should derive provider-specific work from that contract rather than receiving an entire application object.

**Workers are idempotent where practical.** A retry should not produce duplicate logical assets or corrupt metadata. Stable video IDs and deterministic output prefixes should make repeated execution safe.

**Media processing is replaceable.** FFmpeg is the reference implementation, not a dependency the rest of the application should know how to operate directly.

**Playback does no media work.** The playback request path looks up the asset, resolves storage, applies Range semantics, and streams bytes. No probing, encoding, thumbnailing, or imports happen there.

**Graph-like dependency sprawl is avoided in services.** Storage, repository, probing, transcoding, and queue publication should each have narrow interfaces. A feature that requires every layer to know every provider detail is a sign the boundary is wrong.

**SQLite remains valid for the small deployment.** The project should not require a distributed database merely because distributed processing exists. A future Neon/Postgres path may be useful for deployments that need it, but it should solve a concrete need rather than become architectural fashion.

## The interface

The public interface should feel faster than the media it serves.

It is a video product, so the UI should spend visual complexity on video itself rather than on application chrome.

**The catalog is the primary surface.** Category navigation, search, video cards, and pagination should be obvious and fast. The application should not resemble an analytics dashboard unless the user is actually in administration.

**The player page stays focused.** Title, description, category, relevant metadata, and the player are enough. Avoid surrounding playback with social controls the platform does not own.

**The admin interface is operational.** Upload, edit, publish, unpublish, thumbnail management, status, and delete. It should answer "what do I need to do with this video?" rather than "how many dashboard widgets can fit above the fold?"

**Processing state is explicit.** A video that is queued or processing should say so. Failure should expose a useful reason. The UI should not pretend asynchronous work is instantaneous.

**Fast paths look fast.** Search, metadata edits, publishing, and other lightweight operations should not be visually burdened with unnecessary transitions or blocking UI.

**Motion is functional.** Progress bars and state transitions may move because work is actually happening. Ambient animation is unnecessary.

**The default visual system should remain restrained.** Video thumbnails and playback already provide color and motion. The surrounding product should make them easier to scan rather than compete with them.

## Where this is likely to go wrong

**Media processing creeping back into Fresh.** A thumbnail or probe command is easy to add locally and feels harmless. Enough of those decisions will turn the web application into a worker again.

**Treating "S3-compatible" as perfectly identical.** Providers differ in endpoint behavior, authentication details, signed URLs, multipart handling, and edge cases. The abstraction must be tested against actual providers rather than assumed from API labels.

**Range request correctness.** Video may appear to work while seeking, partial requests, cache behavior, or HEAD responses are subtly wrong. This needs protocol-level tests, not only browser playback checks.

**Transcoding state getting out of sync with reality.** The queue may accept a message while the job fails to start. The job may finish while the application never learns that it did. State transitions need an explicit ownership model rather than hopeful sequencing.

**Retries causing duplicate work.** Queue delivery is not the same as exactly-once execution. Output keys and processing operations need to tolerate repeated messages.

**Deleting assets safely.** Removing metadata before deleting media can orphan storage. Deleting media first can leave a published record pointing at nothing. Deletion needs a defined order and recoverable failure behavior.

**Thumbnail processing becoming coupled to upload success.** A failed thumbnail is an optional derivative failure, not a failed source upload.

**Overbuilding adaptive streaming too early.** HLS, multiple renditions, manifests, segment lifecycle, CDN behavior, and transcoding ladders add real complexity. Progressive MP4 should remain the baseline until requirements justify more.

**Extension points turning into a plugin framework.** Frame needs clean boundaries, not an elaborate plugin runtime. Interfaces and hooks should be added only where actual alternate implementations exist.

**Feature pressure.** The greatest long-term risk is that every useful adjacent feature gets accepted because it is useful. The product only stays differentiated if "useful" is not enough. A feature also has to belong in a minimal general-purpose video core.

## What has to be true before this ships

Not "the video played once." Specifics:

- A source video can be uploaded successfully without waiting for transcoding to complete.
- The upload produces a stable source storage key and a valid metadata record.
- A processing message can be published and consumed without coupling the Fresh process to FFmpeg.
- A worker can process the same logical job more than once without corrupting the asset state.
- A failed transcode leaves the original source intact.
- A failed thumbnail generation does not make the video unusable.
- Processing state visibly distinguishes queued, processing, ready/draft, published, and failed conditions.
- A known MP4 can be streamed with correct `206 Partial Content` responses.
- Seeking in the browser causes Range requests and does not force the complete file to be transferred again.
- HEAD and cache behavior are correct for media assets.
- Published videos appear publicly and drafts do not.
- Search, categories, and pagination work without loading the entire library into the browser.
- Deleting a video removes or schedules removal of its owned media assets without touching another video's objects.
- The storage layer can be exercised independently of the Fresh UI.
- The media-processing worker can be exercised independently of the Fresh UI.
- The application can run with local storage without requiring the cloud processing stack.
- The reference S3 deployment can run without embedding provider credentials in source code or container images.
- A processing failure produces a useful operational error rather than only a generic HTTP failure.
- The architecture remains understandable from the repository without needing to reverse-engineer hidden framework behavior.

The final test is simpler than the list:

> If transcoding is overloaded, Frame should still feel fast.

If that stops being true, the architecture has drifted away from the product.
