# Slice 2·3 — Inline preview + safe-delivery sandbox (backend-only) — design

**Status:** Draft (design) · **Date:** 2026-06-19 · **Owner:** Trevor Goldsmith
**White-paper home:** _Inline file preview_ (§18.3)
**Research input:** in-cycle browser-mechanics + threat-model + alternatives analysis (this design cycle); the existing download/presign surface (slice 1·1)
**ADRs:** ADR-0029 (inline file preview, video-first — _concretized & extended by this slice_) · **ADR-`safe-delivery-sandbox` (this slice — cookieless media-subresource delivery, the Worker-signed delivery token, the additive `security.md` mechanism)** · **ADR-`inline-playable-verdict-seam` (this slice — the column-on-`main`, compute-deferred-to-first-reader seam)** · ADR-0067 (request chokepoint) · ADR-0078 (build-when-in-the-area seam columns) · ADR-0090 (value-server-side / cookieless-preview-origin posture)

This spec is the implementation-grade design for slice 2·3 ([`ROADMAP.md`](../../ROADMAP.md)): the delivery/security backend for inline file preview plus the `inline_playable` verdict seam that gates it. It builds on slice 1·1's File Manager substrate (`file`/`file_version`, opaque per-firm R2 keys, the presigned download path, `storage_meter`) and does not restate it. **Backend + Worker surface only** — the Vidstack player and the in-file-manager preview surface defer to the 0·7a/0·7b UI track (the same backend-first precedent as slices 1·1/1·3). This slice **gates on nothing**.

**Build gates:** slice 1·1 backend landed (`file`/`file_version`, status-gated reads, opaque keys, the presigned download), slice 0·5 landed (the ordered chokepoint + `defineOpenAPIRoute` + the OpenAPI snapshot + §3.5 conformance suite), slice 0·4 landed (auth + `AUTH_SECRET`, `@magna-carta/access-control`), slice 0·6 landed (telemetry + `problemJson` + Error-ID correlation).

---

## 1. Scope

**In 2·3:**

1. An additive, nullable, two-axis `inline_playable` verdict column on `file_version`, landed on `main` ahead of the worktrees — NULL-only at launch (no parser, no compute hook, no backfill).
2. A firm-scoped **preview-grant** route (`GET /api/v1/files/{id}/preview`) on the API origin that authorizes through the ADR-0067 chokepoint, reads the verdict + storage facts off the current clean version, runs a pure `decidePreview` gate, and returns a delivery descriptor carrying a **Worker-signed delivery token**.
3. A **host-guarded cookieless serving route** (`GET /api/files-preview/{token}` on the `files.*` host) that streams R2 bytes back wrapped in the safe-delivery header set, with **HTTP Range/206** support as its primary acceptance criterion.
4. Thin **seams**: a `safeRendition` port (null adapter, no engine), a `FILES_ORIGIN` binding, and an additively-widened firm-scoped preview read.

**Deferred / named seams (§11):** the codec-sniff parser, the `runIngest` compute hook, the corpus backfill, the rasterize/transcode rendition engine, the Vidstack player + preview surface, and the Reports "X% inline-playable" roll-up.

**The spine of the slice** is `security.md` _Untrusted file handling_ threat #3 ([`docs/conventions/security.md`](../conventions/security.md)): a malicious SVG/HTML/scripted-PDF executes script in the _viewer's_ browser; server-side sandboxing cannot touch it, so the defense lives entirely in **where** the bytes are served, **what element consumes them**, and **what headers** frame them.

**Preserved, not reinvented:** the per-file download ([`apps/worker/src/routes/files/files.ts`](../../apps/api-worker/src/routes/files/files.ts)) and bulk download ([`apps/worker/src/routes/files/downloads.ts`](../../apps/api-worker/src/routes/files/downloads.ts)) already mint a 300-second presigned R2 GET (`presignerForEnv` → `presignGet`) and 302-redirect the client straight to the R2 S3 host. Bytes already bypass the cookie context. 2·3 keeps that for the **download** case and adds a **preview** case on top.

---

## 2. The consumption model decides everything (the key design choice)

A native `<video>`/`<audio>` element can play a file delivered as a **subresource** even when the response carries `Content-Disposition: attachment` — because `Content-Disposition` has no effect on a response body consumed as a subresource (it is honored only for a top-level navigation/download). This single browser fact lets the slice keep the convention's `attachment` rule **verbatim** and still deliver seekable inline video.

So the consumption model is pinned now (even though the player is deferred), because the header contract is correct for exactly one of two models and the deferred player must not pick the other:

- **CHOSEN — media subresource on the trusted origin.** The deferred player UI lives on the app origin; a native `<video src="files.*/api/files-preview/<token>">` element loads the bytes as a **subresource**. The untrusted bytes reach **only the browser's media decoder** — never an HTML/script parser. An active format mislabeled `playable` (a verdict false-positive) is just an undecodable video; it is never parsed as a document anywhere. `Content-Disposition: attachment` is ignored for this subresource (so it plays) yet honored for a direct top-level hit on the URL (so a typed/middle-clicked link safely **downloads**).
- **REJECTED — `<iframe sandbox>` navigating to the bare media URL as a document.** This model forces `Content-Disposition: inline` (attachment would download instead of render) and routes the bytes through the browser's full document/media viewer, leaning on the sandbox CSP to contain a false-positive. It is a genuine deviation from the `attachment` rule and is strictly weaker on a direct navigation. Rejected for media.

The `<iframe sandbox>` (bare `sandbox`, **never** `allow-scripts`) remains the **only** sanctioned mechanism for the deferred **document-rendition** path (a Container-produced rasterized safe view of HTML/SVG/PDF), inherited by that future slice — it is not used for media here.

**Why safety no longer rests on the verdict being correct:** in the chosen model the bytes only ever reach the media decoder, so a wrong verdict degrades to "undecodable video," not "rendered active document." Safety rests on the cookieless origin + `attachment`-on-navigation + the server-fixed sniffed `Content-Type`, independent of verdict correctness. The verdict gates feature **quality** (does the player attempt inline?); the delivery shape gates **safety**.

**Accepted residual (recorded in the ADR, not silently omitted):** browser **media-decoder RCE** — a malformed-but-decodable file fed to the browser's native decoder — is **not** removed by this design. It is a platform-level risk present identically in any native-inline-playback model (including the white paper's own), out of scope for our Container-only native-parser rule (`security.md` governs _our_ FFmpeg/libvips/ghostscript, not the browser's decoder), and **knowingly accepted for 2·3**. Its genuine eventual mitigation is the deferred Container-produced derived rendition.

---

## 3. Cookieless-origin topology

### 3.1 One Worker, two hostnames — not a second deployment

The cookieless `files.*` host is realized as the **existing `magna-carta` Worker answering a second custom-domain route**, branching on the request hostname into a dedicated cookieless handler that shares nothing with the `/api/v1` chokepoint stack — not a second independently-deployed Worker. The isolation that matters is the **browser origin boundary** (cookieless host + the response headers), a hostname + response-header property, not a deployment property; both shapes give the browser the identical cross-origin boundary. The existing Worker already holds the R2 binding ([`apps/worker/src/app.ts`](../../apps/api-worker/src/app.ts), `wrangler.jsonc`); a separate Worker would duplicate the R2 binding + the `R2_S3_*`/`AUTH_SECRET` secret set for no isolation gain. One deploy, one CI path, one secrets gate.

Cookielessness is structural: this Worker sets **no cookies of its own** (sessions are Better Auth's, carried on the app origin); a request to `files.magnacarta.esq` simply does not carry `app.magnacarta.esq` cookies (different host).

### 3.2 Edge-routing reality: the cookieless path MUST be under `/api/*`

`wrangler.jsonc` sets `run_worker_first: ["/api/*"]` with `not_found_handling: "single-page-application"`. **Everything not matching `/api/*` is served by Workers Static Assets at the edge and never reaches the Worker's `fetch` handler.** A naive `GET /preview/{token}` on `files.*` would be intercepted by the asset binding (a 404 → `index.html`, i.e. the app SPA shell leaking onto the untrusted host) before the Worker ran.

**Resolution (binding):** the cookieless serve path is **`GET /api/files-preview/{token}`** — under the worker-first prefix so the request reaches the Worker, host-guarded so it only ever answers on the `files.*` host. No `run_worker_first`/`not_found_handling` change is required. The active-work note records the dependency on this prefix so a future edit to `run_worker_first` cannot silently strand the route.

Because the path is under `/api/`, the handler is registered **inside the Hono app** as a host-guarded bare route, **before** the `/api/v1` chokepoint routes and **before** the `app.get("*")` ASSETS fallthrough, matching first on the `files.*` host and returning terminally. It runs inside the global telemetry middleware (correlation id + request timing are minted) but, per §8, emits **no** `error_` id or correlation surface to the client. It never falls through to `/api/v1` (no chokepoint, no session) and never to ASSETS.

### 3.3 The host branch sits OUTSIDE the chokepoint

The cookieless handler must not traverse the `/api/v1` chokepoint: that chain resolves a session→firm from cookies that by construction do not exist on `files.*`. Authorization has **already happened** at the API origin; the files host honors a capability-bearing **signed token**, not a session. The handler matches only when `new URL(c.req.url).hostname === FILES_ORIGIN`; everything else on that host 404s with the minimal non-JSON edge body of §8. This is a deliberate, named exception to "every declared route rides the chokepoint" (like Better Auth's surface and health) — with its own standing fitness guard (§6.8), because the conformance chokepoint-composition gate only inspects `/api/v1` paths and is structurally blind to it.

### 3.4 The end-to-end flow

```
Browser (app.magnacarta.esq, session cookie)
   │  GET /api/v1/files/{id}/preview          ← NEW route, API origin, full chokepoint
   ▼
API-origin Worker  (apps/worker/src/routes/files/files.ts)
   │  chokepoint: tenancy → authn → RBAC (permission: null, a read) → rate-limit
   │  getCurrentCleanVersionForPreview(firm.firmDatabase, id)   (status='clean' gated)
   │    → r2_key, size_bytes, version_number,
   │      inline_playable, storage_class, storage_encoding, sniffed_content_type, artifact_role
   │  decidePreview(version):  playable + standard + full + not-derived + sniffed-type-known
   │                           → inline-media ; else → download-only
   │  if inline-media AND FILES_ORIGIN set:
   │     mintPreviewDeliveryToken({ r2Key, bucket, sniffedContentType, verdict, exp })  ← HMAC/AUTH_SECRET
   ▼  200 JSON descriptor, Cache-Control: private, no-store
      { mode:"inline-media"|"download-only", verdict, contentType?, sizeBytes?,
        streamUrl? (files.* host /api/files-preview/<token>),  downloadUrl (always) }
   ▼
Player UI (app origin):  <video src="files.*/api/files-preview/<token>">     ← SUBRESOURCE
   ▼
files.magnacarta.esq/api/files-preview/<token>   (cookieless host, SAME Worker, NO chokepoint)
   │  verify token HMAC (constant-time) with AUTH_SECRET; reject tamper/expiry → bare 404
   │  derive EVERY response header + bucket+key ONLY from the signed payload
   │  R2.get(key[, range]); stream body (no buffering), Range → 206
   │  headers: Content-Disposition: attachment · nosniff · Content-Type=<sniffed> · CSP: sandbox …
   ▼
Browser media decoder plays it; a direct top-level hit on the URL downloads (attachment honored)
```

The two halves never share a trust context: the API origin proves _who you are and what you may see_ and signs the delivery decision into the token; the files host proves nothing about identity and serves only what a valid, unexpired, Worker-signed token names, as bytes that can reach only a media decoder.

---

## 4. The `inline_playable` verdict column (schema seam)

### 4.1 What lands

A single additive, nullable column on `file_version` in [`packages/database/src/per-firm-schema.ts`](../../packages/database/src/per-firm-schema.ts), in the same metadata-seam cluster as the already-landed `storage_encoding` / `artifact_role` / `pinned` / `storage_class` columns. **Nothing else in 2·3 touches this table** — no parser, no compute hook, no backfill.

The verdict is **two-axis** — a render-disposition axis (`playable` | `download-only`) plus an honest `indeterminate` ("sniffed but undecidable"), with **NULL = never-sniffed**. Four first-class states, three non-error:

| Value             | Meaning                                                  | Reader treatment                                         |
| ----------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| `NULL`            | never sniffed (the launch state for the whole corpus)    | download-only fallback — **not** an error                |
| `'indeterminate'` | sniffed, codec/container undecidable                     | download-only fallback — **not** an error                |
| `'download-only'` | sniffed, known non-inline-playable                       | download-only                                            |
| `'playable'`      | sniffed, confirmed inline-playable (MP4/H.264/AAC, WebM) | the **only** value that may unlock the inline-media path |

The fail-safe direction is load-bearing: **only a positive `'playable'` can ever unlock inline-media** — a never-sniffed or undecidable row can never accidentally be served inline, keeping the posture correct even though the sniffer is deferred.

### 4.2 Drizzle change

One field, modeled on the existing nullable-enum-with-CHECK columns:

```ts
inlinePlayable: text("inline_playable", {
  enum: ["playable", "download-only", "indeterminate"],
}), // NULL = never sniffed; set by the codec sniff when a reader first computes it
```

**No `.notNull()` and no `.default(...)`** — this column is genuinely absent until something sniffs. NULL is the never-sniffed sentinel and must stay distinct from `'indeterminate'`; conflating them erases the "have we ever looked?" signal Reports needs. A matching CHECK (`inline_playable IS NULL OR inline_playable IN ('playable','download-only','indeterminate')`) follows the `scan_verdict` nullable-enum precedent. **No index** — NULL for the whole corpus at launch with no predicate-driven read in 2·3; the reader slice adds a partial index only if a `playable` filter becomes hot.

### 4.3 Migration approach (number deferred)

The migration is a one-line additive column (`ALTER TABLE \`file_version\` ADD \`inline_playable\` text;`), generated with `pnpm --filter @magna-carta/database run generate-per-firm-migrations`and verified by the existing schema-conformance/drift tests, not hand-authored. **Do not pre-reserve a number.**`0013`is taken (slice 1·4); the next free is`0014`, but a parallel stream may claim it (the 2·1 worktree carries pending `file_version`migrations). Number at **land time**, gated on`vp run worktrees`. Land the column on `main`ahead of the worktrees — the way`storage_class`/`artifact_role`/`pinned` are already present as pure seams — so the deferred readers find it present.

### 4.4 Read-side exposure ([`packages/file-manager/src/queries.ts`](../../packages/file-manager/src/queries.ts))

The current `selectCurrentCleanVersionStatement` selects only `id, r2_key, size_bytes, version_number`; the delivery gate needs the class/encoding/sniffed-type/verdict/role too. Rather than a parallel read path (which could drift from the quarantine status-gate invariant), **extend the existing status-gated read additively** with a new exported sibling:

- **`getCurrentCleanVersionForPreview`** — keeps the `status = 'clean'` predicate (the file-manager quarantine-gate invariant) and adds `inline_playable`, `storage_class`, `storage_encoding`, `sniffed_content_type`, **and `artifact_role`** to the projection and a widened result interface. This is the single read the preview path keys its gate off. (`artifact_role` is fetched so `decidePreview`'s `derived` branch has a real value; the current clean version is structurally `'original'` today, so the branch is inert but the future rendition path needs no second projection change.)
- **`listCleanVersions`** — widen the **query + `CleanVersionListItem` interface only** to surface `inline_playable`, so the deferred versions surface can read it. **Do not** add `inlinePlayable` to the `FileVersionItem` route response schema in 2·3 — the consuming versions surface is deferred to the player slice, which owns that OpenAPI change. This keeps 2·3's only OpenAPI delta the `PreviewGrant` component (§6.5).

Adding a new exported function (rather than editing `getCurrentCleanVersion` or `ingest-core.ts`) keeps the change conflict-free against the unmerged 2·1 file-manager rewrite. The storage-reconciliation read must **not** gain the column (metering noise).

---

## 5. The decision logic — `decidePreview` (pure, in the file-manager package)

The shallow safe-rendition gate is a pure function over a version row — domain logic, not Worker glue — at `packages/file-manager/src/preview-policy.ts`:

```
type PreviewDecision =
  | { kind: "inline-media"; r2Key; sniffedContentType; sizeBytes }
  | { kind: "download-only"; reason: "verdict" | "unknown-verdict" | "tiered"
                                   | "encoded" | "derived" | "unknown-type" }

function decidePreview(version: CleanVersionForPreview): PreviewDecision
```

Guard: `verdict === 'playable' && storage_class === 'standard' && storage_encoding === 'full' && artifact_role !== 'derived' && sniffed_content_type != null` → `inline-media`; everything else → `download-only`. Evaluation order + `reason`:

1. `inline_playable !== 'playable'` → download-only (`verdict`, or `unknown-verdict` when NULL — the launch state).
2. `sniffed_content_type` NULL/empty → download-only (`unknown-type`). **The verdict and the content-type that frames it are decided in one place**, so the descriptor and the cookieless header set can never disagree.
3. `storage_class !== 'standard'` → download-only (`tiered`). IA charges a per-GB retrieval fee and is, by the white-paper tiering posture, "by definition no longer read" — wrong for a hot, seek-heavy stream.
4. `storage_encoding !== 'full'` → download-only (`encoded`). A delta-encoded object is not a standalone playable byte-range; reconstruction is heavy work that must never happen on the request path (golden rule 10). (Delta is a later seam; at launch every object is `'full'`, so this branch is inert but future-proofed.)
5. `artifact_role === 'derived'` → download-only (`derived`). Inert today (the current version is `'original'`); future-proofs the rendition-as-served-version case.
6. else → `inline-media`.

`reason` is for the response body / audit metadata, never user-facing wording. Keeping the function pure and in the package makes it unit-testable without a Worker and reusable by the future player + Reports. **Because the launch corpus is entirely NULL, every preview resolves to download-only at launch** — the correct, intentional safe default until a sniffer populates verdicts.

---

## 6. Security headers, delivery token & the Worker API surface

### 6.1 `Content-Disposition: attachment` is kept verbatim — the convention rule is untouched

Every preview-route response (`200` and `206` alike, **all** formats including verdict-confirmed playable media) carries `Content-Disposition: attachment`. It is a no-op for the `<video>`/`<audio>` subresource (so the file plays) and honored for a top-level navigation (so a direct hit downloads, even on a verdict false-positive). `Content-Disposition: inline` is **never** emitted by this slice. This **keeps `security.md`'s attachment rule literal and unweakened**; the only convention change is the **additive** one in §6.6 (a second sanctioned inline-render _mechanism_, not a relaxation of the disposition rule).

### 6.2 A presigned R2 GET cannot carry these headers — so inline bytes flow through the Worker under a Worker-signed token

`presignGet` signs only the `host` header, targets `https://<accountId>.r2.cloudflarestorage.com`, and sets no response-header overrides — so a raw presigned GET (a) does not point at `files.*`, (b) carries no `Content-Disposition`/`nosniff`/CSP, and (c) cannot be header-rewritten by the `files.*` handler. So inline-preview bytes **must** flow through a Worker route that re-emits the header set, gated by a **first-party Worker-signed token — not an R2 presign**.

`mintPreviewDeliveryToken` / `verifyPreviewDeliveryToken` ([`apps/worker/src/files/preview-token.ts`](../../apps/api-worker/src/files/preview-token.ts)) sign an opaque token whose payload is exactly `{ r2Key, bucket, sniffedContentType, verdict, exp }`, HMAC-SHA-256 over a key derived from **`AUTH_SECRET`** (already a required secret present in `.dev.vars` and tests). Signing with `AUTH_SECRET` (rather than behind the R2-presigner adapter selection) means **dev/test and production run the identical sign+verify path**, so the negative tests genuinely exercise signature rejection — they are not validated against the no-op dev presigner. The cookieless handler MUST: (1) verify the HMAC **constant-time** (reuse `apps/worker/src/constant-time.ts`) → reject tamper/expiry with a **bare 404**; (2) derive **every** response header + bucket + key **only** from the verified payload, never the URL/query; (3) `R2.get(key[, range])` and stream.

The **download-only / attachment** case is unchanged and keeps the existing 302-direct-to-R2 presigned GET — there the bytes are downloaded, not rendered, R2 scopes the SigV4 signature itself, and the header set is moot.

### 6.3 The exact header set every `200`/`206` carries (byte-for-byte identical)

- **`Content-Disposition: attachment`** (§6.1).
- **`X-Content-Type-Options: nosniff`** — a belt that stops a media/octet stream being upgraded into `text/html`. **Not** the neutralizer (its request-blocking applies only to `script`/`style` destinations, never media); the media decoder is reached via the `<video>` element regardless.
- **`Content-Type: <sniffed type>`** — from the token's `sniffedContentType` (copied from `file_version.sniffed_content_type`), **never** the attacker-controlled `declared_content_type`. The grant guarantees this is non-NULL for any inline token (§5 step 2), so there is no inline path with an `application/octet-stream` fallback.
- **`Content-Security-Policy: sandbox; default-src 'none'; frame-ancestors <app-origin>`** — defense-in-depth for the direct-navigation case (a direct top-level hit lands in a sandboxed opaque origin) and so a future embedder cannot frame `files.*`. `<app-origin>` and the `files.*` host are **env-driven** (`FILES_ORIGIN` + the app origin), never literals.
- **`Cache-Control: private, no-store`** — a credentialed, short-lived, privileged byte stream must not be cached by a shared proxy.

The handler **constructs the `Response` itself** and stamps this identical set on the `200`, every `206`, and the `416`; it **never forwards R2's response headers** (which would leak R2's stored content-type and drop the CSP).

### 6.4 The grant route

`GET /api/v1/files/{id}/preview` belongs in `files.ts` (it shares `loadVisibleFile`/`getCurrentCleanVersion`, `fileParam`, the `authErrors` block, the presigner wiring), registered in `registerFilesRoutes`.

```
const previewFileMeta: RouteMeta = {
  operationId: "files.preview",
  surface: "app",
  authenticated: true,
  permission: null,          // a read — §6.4
  resource: "matter",
  audited: false,            // §6.4
  idempotency: "optional",
  rateLimit: "default",
};
```

- **GET** — a read that exports a delivery credential, no body to fingerprint, harmless to re-issue (the `files.download` reasoning). A GET also sidesteps the `defineOpenAPIRoute` mutating-route guard that would force a non-null permission.
- **`permission: null`** — the `files.list`/`files.get`/`files.download` posture. **Do not invent `files:preview`/`files:read`:** the registry deliberately has no read-only files capability — access is gated by _which matter the member can reach_, not a per-action key; a member who can download can already obtain the bytes. Matter-scoping is enforced by the firm-scoped query against the session firm's physically-isolated D1: a cross-firm file id simply is not in this firm's database → uniform 404, never an existence oracle (golden rule 3, no new code).
- **`audited: false`** — departing from `files.download`'s `audited: true`. The white paper is explicit: **"no per-view logging"** for inline preview. Preview is a cheap, high-frequency in-place view; an audit row per seek/replay would flood the trail. The moment a user pulls the full file, the existing **audited** `download` path records it. This keeps the handler a true read — one firm-D1 read + one in-isolate HMAC sign, no `commitEffectBatch` (golden rule 10). Recorded in the ADR alongside §6.6, not silently omitted. A forensic preview trail for Discovery/portal is a distinct scoped decision (a named seam).

### 6.5 Response — a `200` JSON descriptor, not a bare 302

The grant returns the **decision**, not a `Location` the browser auto-follows (which would also leak the `files.*` URL into the app-origin redirect):

```
const PreviewGrant = z.object({
  mode: z.enum(["inline-media", "download-only"]),
  verdict: z.enum(["playable","download-only","indeterminate"]).nullable(),  // NULL = never sniffed
  // present iff mode === "inline-media":
  streamUrl: z.string().optional(),       // files.* host: /api/files-preview/<signed token>
  contentType: z.string().optional(),     // the SNIFFED type, echoed for the player
  sizeBytes: z.number().int().nullable().optional(),
  // present iff mode === "download-only":
  reason: z.enum(["verdict","unknown-verdict","tiered","encoded","derived","unknown-type","host-unavailable"]).optional(),
  downloadUrl: z.string(),                // ALWAYS present — the AUDITED /download path
}).openapi("PreviewGrant");
```

- `verdict` is **read, not computed** (the parser stays deferred). At launch the column is uniformly NULL, so every grant returns `verdict: null`, `mode: "download-only"`, `reason: "unknown-verdict"`.
- `downloadUrl` is **always** present and points at the **audited `/api/v1/files/{id}/download`** route (which 302s) — never a raw `files.*` inline URL — so the deferred player renders the §18.3 download-only note with a working button, and an active format can only ever reach an explicit download, never an auto-embedding context. (A code comment marks `downloadUrl` as download-intent only.)
- The grant `200` carries `Cache-Control: private, no-store`.

**Errors (RFC 9457 `problemJson`):** reuse the `authErrors` block. Declare **`200` / `401` / `404` / `429`** — matching `files.get` (no `403` for a `permission: null` read). `404` is the uniform not-found for unknown / cross-firm / deleted / quarantined / no-clean-version.

### 6.6 Conformance, OpenAPI snapshot & the minimal `security.md` amendment

The route passes every existing structural gate in `conformance.test.ts` with **no rule change** (the proof it is in-posture). Two mechanical edits: insert `"files.preview"` into the sorted committed-operations array (between `"files.list"` and `"files.update"`), and regenerate the OpenAPI snapshot so the `PreviewGrant` component lands. `PreviewGrant` is 2·3's **only** OpenAPI delta (the cookieless route is a bare host-guarded route, never an `app.openapi` route).

**The `security.md` amendment (additive, not a relaxation).** `security.md` _Untrusted file handling_ threat #3 currently names `<iframe sandbox>` as the inline-render mechanism. The amendment adds a **second** permitted mechanism, strictly narrower in privilege, and leaves the active-format clause untouched. Replace "and `<iframe sandbox>` for inline render" with:

> and — for inline render — exactly two mechanisms: an `<iframe sandbox>` (bare `sandbox`, never `allow-scripts`) for document formats, or a native `<video>`/`<audio>` **subresource** for verdict-confirmed inert media (`Content-Disposition: attachment` is still honored for a top-level navigation and ignored for the media subresource, so the file plays in place yet a direct hit on the raw bytes downloads).

The clause "never hand active formats raw to the browser — preview a derived safe rendition" stays **untouched** (inert verdict-confirmed media was never in its scope). White paper §18.3:728 needs no change. This is a **cross-cutting-file edit** — run `vp run worktrees` before it (§10). The decision + its load-bearing browser-behavior justification (Content-Disposition is honored for navigations but ignored for subresources; `nosniff` request-blocking is script/style-only; bare `sandbox` disables scripts regardless of Content-Type; the navigation/subresource split is current convergent UA behavior — WHATWG Fetch #875 — and **fails safe** to download-only; media-decoder RCE is the accepted platform residual) lives in the pending ADR.

### 6.7 Range/206 streaming — the slice's primary acceptance criterion

Seekable playback is the feature; the Range contract is its primary, harness-tested acceptance criterion (not a residual). It is a net-new shape (the bulk-download `200` ZIP stream is no precedent for ranged single-object delivery):

- `Accept-Ranges: bytes` on every response. Read `Range`; pass to `env.R2.get(key, { range: { offset, length } })`.
- The handler constructs the `206` itself: status `206`, `Content-Range: bytes X-Y/total`, `Content-Length` = the slice length (not the file length), a strong **`ETag` (R2 `httpEtag`) + `If-Range`** for clean resume, **and the identical §6.3 safe-header set**. It never forwards R2's headers.
- A malformed/unsatisfiable/multi-range `Range` → `416` carrying the same safe headers, no body.
- No `Range` → the full `200` stream (`R2.get(key)` body piped into a `Response`), never buffered (golden rule 10).
- **Null-object branch:** a valid token whose `R2.get` returns `null` (the object reaped between mint and fetch) returns the same minimal non-JSON `404`/`410` "preview no longer valid" as the expired-token case (§8) — `attachment`, `nosniff`, no `error_` id. Guarded explicitly so a `.body` deref never throws into the telemetry error boundary on the untrusted edge.

Token TTL reuses `DOWNLOAD_TTL_SECONDS = 300` — long enough to start playback, short enough that a leaked URL expires; a leaked inline URL is further defanged by naming a verdict-confirmed-playable object only. A distinct `PREVIEW_TTL_SECONDS` is over-engineering until the player measures a need.

### 6.8 A standing fitness guard for the cookieless surface

The conformance chokepoint-composition gate inspects only `/api/v1` paths and is **structurally blind** to `/api/files-preview/{token}`. So the slice adds a **dedicated, non-skippable guard** (in `conformance.test.ts` + the header-builder table tests of §9) pinning: (1) the files-host branch is registered once, is host-guarded (only answers when `hostname === FILES_ORIGIN`), and is terminal (never falls through to `/api/v1` or ASSETS); (2) every `200`/`206` carries the exact §6.3 header set including `Content-Disposition: attachment`, and **`Content-Disposition: inline` is never emitted anywhere in the slice**; (3) the host branch emits no `error_` id / correlation handle on any error.

### 6.9 Desktop transport invariant (pinned now)

The preview route is served over **real HTTP(S)** from the cookieless host on **both web and desktop**. Tauri (WebView2/WKWebView) MUST hit the same network route, **never** a `tauri://` asset/custom-scheme proxy — those transports do not honor HTTP Range, so seeking silently dies (WebView2Feedback #2679). Desktop parity is then automatic; this is a deliberate, recorded non-feature pinned while we are in the area (the player UI is deferred, but the transport contract it inherits is fixed now).

### 6.10 CORS posture (decided)

`crossorigin` is **ungranted at launch** — the cookieless host sends **no** `Access-Control-Allow-Origin` (tighter, correct: a native `<video src>` subresource needs no CORS). The ADR records that the eventual player slice may flip to `crossorigin="anonymous"` + a scoped `Access-Control-Allow-Origin` + `Access-Control-Expose-Headers: Content-Range, Accept-Ranges` **only** when richer player telemetry / subtitles / canvas / thumbnails need it.

### 6.11 Pre-apex behavior — functional on the current deployment

`FILES_ORIGIN` does not exist until `magnacarta.esq` attaches (both hosts are workers.dev-only today). The grant route **degrades to download-only whenever `FILES_ORIGIN` is unset**: `mode: "download-only"`, `reason: "host-unavailable"`, no `streamUrl`, the always-present `downloadUrl`. (`host-unavailable` is a **route-level** reason the grant emits when delivery is impossible despite an otherwise-`inline-media` decision — distinct from the pure `decidePreview` reasons of §5, which never include it.) This dovetails with the NULL-verdict launch reality (every grant is download-only anyway), so the route is testable and non-broken now, and the cookieless path lights up automatically once `FILES_ORIGIN` binds. For CI/staging exercise of the cookieless branch, `FILES_ORIGIN` is set in the test env binding (§9).

---

## 7. The `safeRendition` port (seam, no engine)

The white paper's structural rule is that active formats get a derived safe rendition; 2·3 honors it the cheap way (download-only) but leaves a **port** where the rasterize/transcode adapter wires in later — mirroring the existing `MalwareScanPort`/`unscannedAdapter` precedent. At `packages/file-manager/src/safe-rendition-port.ts`:

```
interface SafeRenditionRequest { versionId; r2Key; sniffedContentType; target: "rasterized-image" | "transcoded-mp4" }
interface SafeRendition { renditionVersionId; r2Key; contentType }   // artifact_role:'derived', written back to R2
interface SafeRenditionPort {
  lookup(req): Promise<SafeRendition | null>;   // 2·3 only ever looks up, never builds
  request(req): Promise<SafeRendition>;          // UNIMPLEMENTED in 2·3
}
```

The launch adapter (`nullSafeRenditionAdapter`) returns `null` from `lookup` and throws a typed `SafeRenditionNotAvailableError` from `request`. **Wire the port + null adapter, but do NOT call `lookup` from the preview handler in 2·3** — keeping the handler's only dependencies the token minter + the pure `decidePreview` ships zero rendition coupling now. The player slice that needs renditions adds the `lookup` call where a comment marks the seam. The `derived` artifact role and the write-back-to-R2 contract already exist on the schema, so the rendition path needs no new columns.

---

## 8. Error handling, redaction & the cookieless edge

Every failure on the API-origin grant goes through `problemJson`, which mints `error_<id>`, stamps the per-request `correlationId`, and sets `instance` to the path. 2·3 adds no new problem shape. The two-origin split forces an explicit error-path decision:

1. **Grant errors (API origin):** reuse `authErrors`/`problemJson`. The verdict-gating decision (download-only/indeterminate/NULL/IA/encoded → download-only) is **not an error** — it is a successful `200` carrying the mode. A `download-only` mode must never surface as a 4xx.
2. **Cookieless-host errors (`files.*` edge):** the download-only 302 fails at R2 (R2's own S3 error body — deliberately not reshaped into RFC 9457, which would require proxying untrusted-context responses through our origin). The inline Worker-proxied path returns, for token tamper/expiry (§6.2) and the missing-object race (§6.7), a minimal **non-JSON `404`/`410`-class** "this preview link is no longer valid": `Content-Disposition: attachment`, `nosniff`, **no** `error_` id and **no** correlation surface (an unauthenticated edge must not emit an existence oracle or a server-trace handle). All _authorization_ failures are forced back to the API origin before any token is minted, so the cookieless host never renders a privileged error.

**Redaction (golden rule 4):** no log on either path carries file bytes, sniffed content, the presigned URL query string, or the signed preview token (a bearer credential). The download path's `file.downloaded` audit row stays metadata-only; the preview grant writes no audit row (§6.4).

**`lint:process-refs` (golden rule 13):** the route description + header comments state the reasoning inline ("untrusted bytes served cookieless so a malicious file reaches only the media decoder, never a privileged origin") and cite [`docs/conventions/security.md`](../conventions/security.md) **by path** — never an ADR number or slice tag. The one allowed exception is a forward-looking "the transcode rendition wires in when the player UI lands."

---

## 9. Test strategy

Three layers, matching the existing file-surface topology.

**1. Unit — pure header/verdict-gating + token sign/verify (no Miniflare).** Tables, the way `presign.test.ts` is tested:

- Verdict → mode: `playable` + standard + full + not-derived + sniffed-known → `inline-media`; `download-only`/`indeterminate`/NULL → `download-only`; `playable` but IA OR `storageEncoding !== 'full'` OR `artifactRole === 'derived'` OR `sniffedContentType == null` → `download-only`. **`verdict='playable'` + `sniffedContentType=null` → download-only, never inline-media** (the §5 single-decision guard).
- Fixed header set: `attachment` (always), `nosniff`, the sandbox CSP literal, `Content-Type` from `sniffedContentType` — assert a row where declared ≠ sniffed and prove the **sniffed value wins**. **Assert `Content-Disposition: inline` is never produced by any builder path** (the §6.8 invariant).
- Token round-trip + negatives: a fresh token verifies to the exact payload; a tampered token (flipped byte, swapped `r2Key`/`bucket`, expired `exp`) **fails verification**. Signed with `AUTH_SECRET`, so this exercises the real production sign/verify path.
- Fail-closed: NULL verdict and an unknown verdict string both collapse to `download-only`. **This is the stored-XSS regression guard and must never be weakened.**

**2. Miniflare e2e over the real HTTP surface** (`SELF.fetch`, the `files-routes.test.ts` rig). Extend `seedCleanFile` to set the four columns; set `FILES_ORIGIN` in the test env:

- **auth → grant:** owner cookie → grant for a `playable` standard-raw version → `200` `mode: "inline-media"` + a `files.*` `streamUrl` + `Cache-Control: private, no-store`; assert **no** audit row was written.
- **cookieless host fetch (the core defense):** `SELF.fetch` against the `FILES_ORIGIN` host with the token; assert (a) the host branch matched and **no session cookie was consulted**, (b) the full header set including `Content-Disposition: attachment`, `nosniff`, sandbox CSP, `Content-Type` = sniffed type, (c) **sniffed type wins over declared**, (d) a forged/expired token → **bare 404** with no `error_` id / correlation surface.
- **Range/206 (primary acceptance):** a `Range` request against a known-good MP4 fixture → `206` + correct `Content-Range`/`Accept-Ranges`/`ETag` **and** the safe header set intact; an unsatisfiable range → `416` with the safe headers. **Buildable and asserted today with verdict-gating stubbed to deny** (the Range contract does not depend on the sniffer).
- **download-only path:** a `download-only`/NULL/`playable`-but-IA version → `mode: "download-only"`, no `streamUrl`, proving an active/untrusted format is never handed to the media path.
- **tenant isolation at the cookieless layer:** a token whose `r2Key`/`bucket` names firm B, presented cold (no session), serves only what firm B's grant legitimately minted — proving the **signature + signed bucket** (not just firm-D1 visibility) scopes the byte fetch; a cross-firm file id at the **grant** still 404s.
- **read-only member:** a Read-only cookie still gets a read grant (preview is `permission: null` like `files.get`/`files.download`); confirm it is not gated behind `files:organize`.
- **pre-apex degrade:** with `FILES_ORIGIN` unset → `mode: "download-only"`, `downloadUrl` only.

**3. Conformance / fitness.** The grant passes the existing structural gates with no rule change (the two mechanical edits of §6.6); the cookieless surface carries its own standing guard (§6.8).

---

## 10. Load-profile column: `[-]` (no extension), justified

Per the accretion rule (ADR-0078/0083), 2·3 adds **no per-firm data surface the volume harness must model**: the `inline_playable` column lands additive/nullable/NULL-only (no backfill, no new rows — a uniformly-NULL column changes neither query cost nor row-count distribution; `file_version` volume is already generated by the 1·1/2·1 fixtures); cookieless delivery is stateless (mints an ephemeral signed token, streams an existing R2 object, persists nothing; the grant is unaudited so writes zero rows); the verdict-gating read joins no new table (it reads columns already on `file_version`). **Forward obligation, named not pre-paid:** the reader slice that lands the codec-sniff parser + corpus backfill (the 2·1 ingest rebuild, the player, or Reports) populates the verdict at volume and **must** extend the harness then — a non-NULL distribution is exactly what Reports' "X% inline-playable" `GROUP BY` roll-up will query.

---

## 11. Worktree coordination (the 2·1 overlap hazard)

A live 2·1 worktree (`slice-2-1-design-and-plans`, `C:/dev/magna-carta-2-1-dev`, **built but unmerged**) carries **no `docs/active-work/` note**; main's `STATUS.md` 2·1 row reads unbuilt (stale). **Consequence:** `vp run worktrees` will **not** surface the `packages/file-manager` overlap. The 2·3 stream therefore:

1. Keeps its own `docs/active-work/slice-2-3-safe-delivery.md` note (the touch list).
2. **Never edits `ingest-core.ts`** — the verdict compute hook is deferred to the reader slice. Lands all file-manager changes **additively** (a new exported read, a new `preview-policy.ts`, a new `safe-rendition-port.ts`). Before touching anything under `packages/file-manager/`, **sync `main` and manually diff `queries.ts`/`per-firm-schema.ts` against `C:/dev/magna-carta-2-1-dev`** (the registry will miss these) to verify 2·1 has not relocated/renamed the status-gated reads.
3. **Numbers the migration at land time**, gated on `vp run worktrees`, anchored on the column name. The column is nullable/additive/reader-free, so it can land **ahead of 2·1's merge** without ordering risk.
4. **Landing sequence (gates on nothing):** first, on `main` ahead of the worktree, the additive `per-firm-schema.ts` column + its migration + the schema test; then, on the 2·3 branch, `decidePreview`/the token/the port/the grant route/the files-host branch/tests/snapshot/conformance-array edit + the two pending ADR fragments + the `security.md` amendment.
5. **At merge:** edit **only the 2·3 `STATUS.md` row** (do not "correct" the stale 2·1 row — 2·1's merge reconciles it). CHANGELOG + the ADRs go through fragments (`changelog.d/`, `docs/decisions/pending/`), never a direct rendered-file edit. The `security.md` amendment is a cross-cutting edit — `vp run worktrees` before it.

---

## 12. Deferred seams (summary)

| Seam                                                                                                                | Lands when                                                                          |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `inline_playable` codec-sniff **parser** (file-type is codec-blind; a net-new head-bytes container+codec probe)     | the first reader slice (2·1 ingest rebuild, the 0·7a/0·7b player, or Reports)       |
| `runIngest` **compute hook** writing the verdict on commit                                                          | the 2·1 ingest rebuild; **`ingest-core.ts` is off-limits in 2·3**                   |
| **Corpus backfill** of `inline_playable` for committed versions                                                     | the reader slice (likely Reports) — which also extends the load-profile harness     |
| `safeRendition.request()` / the **rasterize+transcode engine** (FFmpeg/libvips Container, derived write-back to R2) | the player UI / slice 2·4 in-app conversion; 2·3 ships only the port + null adapter |
| `safeRendition.lookup()` **call site** in the preview handler                                                       | the 0·7a/0·7b player, to upgrade a download-only outcome into a rendition-stream    |
| The **document-rendition `<iframe sandbox>`** render path (HTML/SVG/PDF safe view)                                  | the rendition slice; bare `sandbox`, never `allow-scripts`                          |
| **Vidstack player + in-file-manager preview surface** consuming the grant (`<video>` subresource on the app origin) | the 0·7a/0·7b UI track                                                              |
| `inline_playable` on the `FileVersionItem` **route schema**                                                         | the player/versions slice (2·3 widens only the package query/interface)             |
| Reports **"X% inline-playable"** firm-wide roll-up (`GROUP BY inline_playable`, NULL = "not-yet-assessed")          | a future reader of the column                                                       |
| `crossorigin` / `Access-Control-*` on the cookieless host                                                           | the player slice, only when subtitles/canvas/telemetry need it (§6.10)              |
| `FILES_ORIGIN` binding + the `files.*` custom-domain route (grant degrades to download-only until set)              | when `magnacarta.esq` attaches                                                      |
| **Container-produced derived rendition** as the real mitigation for media-decoder RCE                               | the rendition slice (the accepted §2 residual's eventual fix)                       |
| Per-view / preview **audit trail** for Discovery / portal                                                           | a distinct scoped audit decision for those surfaces                                 |
| `PREVIEW_TTL_SECONDS` distinct from `DOWNLOAD_TTL_SECONDS`                                                          | when the player measures a need (reuse 300s until then)                             |
