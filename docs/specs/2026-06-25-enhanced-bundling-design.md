# Enhanced Bundling — design

_Status: design (brainstormed 2026-06-25). Not built. Implementation gets an ADR and a `writing-plans`
plan before any code._

## Context

The platform already turns a selection of matter files into a downloadable ZIP — the **bundle** path:

- `packages/file-manager/src/zip-composition.ts` resolves a `{folderIds, fileIds}` selection over a
  matter's **clean** files into version-pinned entries with folder-tree paths, name-collision
  disambiguation, and a content-addressed `bundleManifestHash`.
- `apps/worker/src/downloads/` serves `POST /api/v1/downloads/zip` with three delivery paths: single
  file → 302 presigned GET; small multi-file → inline streamed ZIP; large → an async background build
  coordinated by the `BundleBuildCoordinator` Durable Object, streamed R2 → `client-zip` → R2
  (multipart), with a poll endpoint (`GET /api/v1/downloads/bundles/{manifestHash}`) that mints a fresh
  signed URL when ready.

That pipeline is ZIP **store-mode only** (no compression), **no encryption**, **single artifact**. The
firm owner wants an enhanced download experience: choose the **format**, optionally **compress**,
**encrypt**, and **split** — plus a few quality-of-life options. This is **general convenience** (a
better download), not a legal-production workflow (no Bates, no production manifests, no closeout/
retention coupling).

The word **"archive"** is deliberately avoided: in this product *archive* means retired/retention items.
The codebase's own term for a packaged download is **"bundle"**, and that is the term used throughout.

### Classification

This is **not a new Tool** (the Tools area is matter-grade work done *without* committing to a matter;
this only makes sense acting on files already in a matter) and **not a new subsystem**. It is an
**enhancement of the existing bundle / bulk-download path**, surfaced as advanced options on the matter
file download/export action. `matterContext` is effectively required.

## Goals

- Let a user bundling matter files choose: **format** (ZIP, 7z), **compression** (store / normal / max),
  **encryption** (AES-256, password), and **split** (format-native multi-volume by max part size).
- Quality-of-life: **name the output**, a **wrapper folder** (default the matter name), a
  **preserve-structure vs. flatten** toggle, and an optional **`CONTENTS` manifest** (path + size +
  SHA-256 per entry).
- Keep the cheap streaming path for plain downloads; only escalate to heavy machinery when the options
  demand it.
- Make the format set **extensible** — a third format is a drop-in, not a rewrite.

## Non-goals (deferred seams — named, not built)

- Deliver-to-client-portal / email instead of download (ties into the safe-delivery + portal slices).
- Digital signatures / tamper-evidence.
- Selecting non-current file versions (bundles pin the clean current version, as today).
- Smart per-type compression (auto-store already-compressed JPEG/PDF).
- Legal-production features (Bates, production logs) — explicitly out of scope.

## Rejected

- **Self-extracting `.exe` (SFX)** — antivirus flags it, it is a malware vector, and it clashes with the
  untrusted-file posture. Hard no.
- **RAR output** — proprietary / licensing. No.
- Exposing compression **method / dictionary / word size / thread count** as user knobs — these are
  performance internals the builder auto-tunes from the chosen level (LZMA2 + solid for 7z, Deflate for
  ZIP). 7-Zip's depth is here; none of it belongs in a "general convenience" UI.

## Options model

A single `BundleOptions` shape (home: `@magna-carta/file-manager`, alongside the existing
`zip-composition.ts`):

| Option | Values | Notes |
| --- | --- | --- |
| `format` | `zip` \| `sevenZip` | Via a pluggable encoder registry (below). |
| `compression` | `store` \| `normal` \| `maximum` | Builder maps to Deflate (ZIP) / LZMA2 + solid (7z). |
| `encryption` | none \| `{ algorithm: "aes-256", encryptFileNames?: boolean }` | Password supplied at request time, never stored. `encryptFileNames` only meaningful for 7z (ZIP-AES always leaves names visible). |
| `split` | none \| `{ maxPartBytes }` | Presets in UI (e.g. ~20 MB email); format-native multi-volume. |
| `outputName` | string | The bundle's display file name. |
| `wrapperFolder` | none \| `{ name }` | Default: the matter name. Nests all entries under one top folder. |
| `layout` | `preserveTree` \| `flatten` | `flatten` collapses all entries into the (optional wrapper) root, re-running collision disambiguation. |
| `manifest` | boolean | Include a generated `CONTENTS` file: per-entry path + size + SHA-256. |

**Always-on correctness (not knobs):** ZIP64, UTF-8 entry names, cross-platform name sanitization
(Windows reserved chars / length), and original-timestamp preservation.

The existing pure resolver `resolveZipSelection` is reused to produce entries; the layout/wrapper/flatten
transforms compose on top of its output (still pure, still unit-testable without Miniflare).

## Format-encoder registry

Mirrors `@magna-carta/conversion`'s registry pattern (a small registry + a port), so a new format is a
new adapter row, not a code change to callers:

- An `EncoderId` (`zip`, `sevenZip`) maps to an encoder that, given the resolved entries + a `BundleOptions`
  and a streamed source for each entry's bytes, produces the archive byte stream(s) (one per volume).
- The encoders themselves live in the **Rust container** (below); the TS side stores only the registry of
  available `EncoderId`s + their capabilities (supports-encryption, supports-header-encryption,
  supports-split) so the UI can gate options per format.

## Two build lanes

**Fast lane (unchanged).** Plain ZIP, `store`, no encryption, no split → the existing `client-zip`
streaming path (Worker → R2 multipart). Cheap, already built, default for plain downloads.

**Heavy lane (new).** Anything needing compression, encryption, 7z, or split → a dedicated Rust
Container, `containers/bundle`, mirroring `containers/scan`:

- An axum HTTP service that streams the selected R2 object bodies through the chosen encoder and writes
  the resulting volume(s) back to R2, never buffering the whole archive.
- Rust crates (pins verified against docs.rs per golden rule 11 before use): the `zip` crate (Deflate +
  ZIP64 + AES) and a 7z encoder crate (LZMA2 + AES-256 + header encryption + multi-volume); the exact
  7z crate is a build-time spike decision.
- Deploy-time activation (cannot run under `@cloudflare/vitest-pool-workers`), exactly like
  `containers/scan`; a CI job builds the image and runs an acceptance gate (build a bundle, re-open it,
  verify contents + that an encrypted/split bundle round-trips).
- Short idle-sleep so it scales to zero between bursty builds (cost note below).

## Orchestration

Reuse the `apps/worker/src/downloads/` subsystem — the `BundleBuildCoordinator` DO + the `bundle-build`
queue + the poll endpoint — extended:

- The build message + job state carry the `BundleOptions` and the (possibly multiple) output R2 keys.
- The manifest hash that keys dedup/caching now includes the **options** (format, compression, split,
  layout, wrapper, manifest) so two different option sets don't collide on one cached artifact.
- **Encrypted bundles bypass the durable queue and the R2 cache.** A plaintext password in a durable
  queue message would persist it, and encrypted output is non-deterministic (random salt/IV) so it
  can't be content-addressed. Encrypted builds run single-flight with the password held **in-memory
  only** (request → coordinator/consumer → container, never written to D1/R2/logs), and the artifact is
  treated as one-shot (short-TTL signed URL, not a reusable cache entry).
- Split output produces multiple `bundles/<hash>/<name>.zNN` (or `.7z.NNN`) objects; the poll endpoint
  returns the set of signed URLs (or a small index) when ready.

## Surface (UI)

A "Bundle options…" affordance on the existing matter file/folder multi-select download action (design
system + Bits UI only, per golden rule 2). Options gate per format from the registry capabilities
(e.g. `encryptFileNames` only shows for 7z). Password input uses a masked field; a "never stored,
share it out-of-band, unrecoverable if lost" notice is shown when encryption is on.

## Cost

Cloudflare Containers bill per-second on **active CPU only** and **scale to zero**. A typical build
(~hundreds of MB, ~30 s, 1 vCPU / 2 GiB) ≈ **$0.0008**; a worst-case multi-GB encrypted 7z (~5 min)
≈ **$0.0075**. The Workers Standard plan (already paid) includes 375 vCPU-minutes + 25 GiB-hours/month,
which absorbs typical volume — effectively **$0 incremental** at low volume. The Container platform is
already committed (`containers/scan`); this is a second image, not a new commitment.
([pricing](https://developers.cloudflare.com/containers/pricing/),
[new CPU pricing](https://developers.cloudflare.com/changelog/2025-11-21-new-cpu-pricing/))

## Security / invariants

- **Clean-only.** Bundles are built only from `status = 'clean'` current versions — the existing resolver
  guarantees a pending/quarantined/deleted version can never enter a bundle. Unchanged.
- **Password never persisted** — in-memory only, never to D1/R2/logs/queue messages. Redaction by
  default (golden rule 4).
- **Per-firm isolation** — the manifest hash and DO name stay firm-scoped; artifacts live in the firm's
  bucket; a firm can only read its own job (unchanged from the existing flow).
- **No bytes buffer in the Worker** — the fast lane streams as today; the heavy lane streams R2 → encoder
  → R2 in the container.

## Open decisions for the plan / ADR

- The exact 7z Rust crate (build-time spike).
- Whether the manifest hash for unencrypted-but-optioned bundles stays a single hash or gains an options
  sub-key (recommended: fold options into the canonical hashed input).
- Instance size for `containers/bundle` and its idle-sleep timeout.
- An ADR recording: bundle (not "archive") naming, the two-lane split, the encrypted-bundle no-cache /
  no-durable-queue rule, and the dedicated-container decision (consistent with the standing
  "Container subsystems extract to dedicated workers" rule).

## Verification (when built)

- Pure unit tests (no Miniflare) for the options/layout/wrapper/flatten transforms over
  `resolveZipSelection` output, and for the per-format capability gating.
- Container acceptance gate (CI, not the local worker pool): build a ZIP and a 7z bundle, with and
  without compression / encryption / split, then re-open each and assert the contents, the wrapper
  folder, the manifest, and that an encrypted/split bundle round-trips and rejects a wrong password.
- Worker integration (Miniflare): the fast lane still streams; the heavy lane routes to the container
  adapter (stubbed in tests, like the scan adapter); encrypted requests never persist the password.
- Load-profile fixtures exercised for a large/split build per golden rule 10.
