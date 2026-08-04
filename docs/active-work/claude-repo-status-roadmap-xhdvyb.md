---
branch: claude/repo-status-roadmap-xhdvyb
worktree: (remote session — no local worktree path)
area: slice 2·4 close-out step 1 — per-engine dispatch seam + tracking refresh
status: review
touches: apps/worker/src/conversions/, apps/convert-worker/src/, apps/worker/CLAUDE.md, ROADMAP.md (2·4 bullet), status.d/, changelog.d/
---

Slice 2·4 close-out, step 1 of the agreed sequence. Everything below is committed and pushed on
this branch; this note doubles as the handover for whichever session continues the stream.

## What this branch contains (3 commits + a merge of `main`)

1. **Per-engine dispatch seam** — each conversion hop resolves its own engine by id end to end:
   `resolveEnginePort` (apps/worker/src/conversions/conversion-engine.ts) returns an
   `EngineResolver`; the service-binding adapter stamps `x-engine-id`; the convert worker
   (apps/convert-worker/src/engine-dispatch.ts + index.ts) dispatches on that header. Raster-served
   ids (`libvips`, `image-pdf`) route to the RasterEngineContainer; `libreoffice`/`email`/`ffmpeg`
   stay typed `engine-not-implemented`; a missing header defaults to raster (deploy-order safety);
   an unknown id gets 501. A new engine Container is now an additive dispatch entry — no
   orchestration change.
2. **Tracking refresh** — the ROADMAP 2·4 bullet and `status.d/2-4-in-app-conversion.md` now state
   the true position (sub-slices a–e built and on `release`; activation is deploy-time; remaining
   work enumerated). The `status.d` registry repairs that rode along have since been made on `main`
   independently, so the merge keeps `main`'s (see below).
3. **Fitness-test repairs** — superseded: `main` repaired both files itself while this branch sat in
   review, so the merge keeps `main`'s versions verbatim.

## Merge reconciliation (`main` merged 2026-08-04)

`main` advanced ~11 merges after this branch was verified, and three of them landed in the same
places:

- **The OCR conversion edge** turned `resolveEnginePort` into an `EngineResolver` on `main` too, and
  routed the `ocr` engine to its own `OCR_SERVICE` binding. Both sides are kept: `ocr` resolves to
  the OCR service; `libvips`/`image-pdf` resolve to the convert worker's service-binding port (which
  stamps `x-engine-id`); everything else stays deferred. The two seams are complementary — the
  convert worker never sees an OCR hop.
- **The status registry** was repaired on `main` by deleting the stale `branch:`/`active-work:`
  pointers outright and renumbering cross-cutting order slots around the new `searchable-pdf-writer`
  entry (decryption→23, file-manager-primitives→24, ocr-engine→25, searchable-pdf-writer→26).
  `main`'s numbering wins; `eyebrow-link` went back to its original slot 22, which `main`'s
  renumbering freed. `lint:status` is valid for all 51 slices.
- **The two fitness tests** were repaired on `main` as well, and more robustly (the control-plane
  head tag is asserted through `controlPlaneHeadSchemaVersion()` rather than a literal tag), so this
  branch's versions were dropped.

The bucket-resolution seam (`resolveFirmBucket`) that `main` routed through the conversion **routes**
does not touch the queue consumer, which still reads and writes `env.R2` directly — unchanged by this
branch and unchanged by the merge.

## Verification state (all green)

Re-verified on the merged tree (2026-08-04): conversion package 60 tests / 11 files · convert-worker
6 tests / 2 files + `vp check` clean (0 errors, 1 pre-existing generated-file warning) · the full
worker suite 1,123 tests / 174 files, all passing (this covers the four conversion files and both
fitness files) · `lint:status` valid for 51 slices · `lint:process-refs` clean. The nine
`lint:process-refs` findings this branch had left alone were fixed on `main` in the meantime.

**Environment notes for a successor session:** the worker suite needs the three Rust→WASM artifacts
built first — `pnpm exec vp run bootstrap` does all three — or ~117 files fail on a missing `pkg/`
module. The worker-scoped `vp check` takes ~35 minutes on a constrained machine; the full worker
suite ~18 minutes. `vp` is not on PATH in the remote container — use `pnpm exec vp` / package
scripts. A file-path argument passed after `pnpm --filter … run test --` is not forwarded to
`vp test run`, so that invocation runs the whole project suite.

## Owner-action ledger (as of 2026-08-04)

- **magna-carta-convert:** owner reports connected to Workers Builds and set to `release`.
  UNVERIFIED from a session: (a) the deployed worker is the real one (settings show the
  `RASTER_ENGINE` DO binding + container image — the placeholder has neither) and its first build
  (which compiles the Rust container) went green; (b) the `conversions/` R2 lifecycle rule (~24h)
  exists — a separate dashboard step.
- **magna-carta-edit:** owner reports dealt with; verify branch control reads `release` and the
  first post-repoint build is green (it had 8 consecutive failures through 2026-06-28). Blocks the
  2·2 Stage-2 document-open verification.
- **Verification path:** the owner was asked to add `CLOUDFLARE_ACCOUNT_ID` +
  `CLOUDFLARE_API_TOKEN` (read-only: Workers Builds Read, Workers Scripts Read, R2 Read) to the
  Claude Code environment. When present, close the ledger with:
  `GET /accounts/{id}/builds/workers/{script_tag}` (convert + edit), the script-settings read
  (bindings ⇒ real vs placeholder), and the R2 bucket lifecycle read.
- **Deploy queue:** production is `release@0988844` (2026-07-04); `main` is ~250 commits ahead and
  this branch is not yet on `main`. The dispatch change is backward-compatible with an
  already-deployed pre-dispatch convert worker (missing header → raster). Ship path: merge this
  branch → `main`, then a deliberate `git push origin main:release`.

## Next steps in the agreed 2·4 sequence

- **Step 2 — LibreOffice engine (2·4f), the critical path.** BLOCKED on the owner's golden-rule-14
  consent (C++ runtime; the 2·2 Collabora container is the consented precedent). Design inputs
  already settled in docs/research/in-app-conversion.md: LibreOfficeKit fork-pool (Collabora
  `convert-to` internals as the model; MPL-2.0, `kit/Kit.cpp` + `ConvertToBroker` are the
  load-bearing files), one-conversion-per-instance (naive concurrent `soffice --convert-to` fails
  silently), Carlito+Caladea fonts baked into the image. Open at design time: LOK binding choice
  (`jacobtread/libreofficekit` vs direct), pool sizing/health-recycle. Closes docx/odt→pdf,
  docx→odt, wpd→odt (+ the wpd→pdf chain); feeds 2·6.
- **Step 3 — email→PDF render engine.** Parse substrate (`crates/email-core`) is built;
  `status.d/email-core-parse-engine.md` names this engine as its next. Constraints: render must be
  network-isolated, inline only the message's own CID parts, never `wkhtmltopdf`
  (CVE-2022-35583). Recommended start: LibreOffice headless — i.e. it rides Step 2's container.
  Coordinate with the email filing/capture stream before starting.
- **Step 4 — matter-attached save-as-version (parallel, pure TypeScript).** Precedent:
  `commitEditedVersion` / `restoreVersion` in packages/file-manager/src/file-service.ts (trusted
  server-generated writes, `scanVerdict: "unscanned"`, never through `ingest-core.ts`). One design
  decision first: new version vs sibling file vs derived rendition. Coordinate: the
  file-manager-contract and file-repair-salvage streams also touch packages/file-manager, the
  permission registry, per-firm migration slots, and the generated OpenAPI/client.
- **Step 5 — FFmpeg engine (fast-follow).** Minimal `--disable-*` build, seccomp/AppArmor, no
  egress; shares the H.264/AAC+faststart recipe with 2·3's deferred preview transcode.
- **Consumer follow-through when a second engine lands:** extend `CONVERT_WORKER_ENGINE_IDS`
  (conversion-engine.ts) + `engineTargetFor` (engine-dispatch.ts) + a new Container class in
  apps/convert-worker — that is the entire wiring surface.

## At merge

Delete this note, run `vp run status-build` on `main`, and let `changelog-build` consume
`changelog.d/conversion-per-engine-dispatch.md`. The `status.d` order slots now follow
`main`'s numbering, so no other stream needs warning.
