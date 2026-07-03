# File Type Verifier — design

**Status:** Accepted (design) · **Date:** 2026-06-26 · **Owner:** Trevor Goldsmith
**White-paper home:** _Plugin / Add-on system_ ("pure utilities are libraries, not plugins").
**Builds on:** the Tools area (`docs/specs/2026-06-16-tools-area-design.md`) · the file-tool family (Metadata Inspector & Scrubber, File Hash & Integrity) · the malware-scan subsystem (`apps/scan-worker`, `containers/scan`) and its raw-facts engine split · the container-extraction rubric (`docs/conventions/operations.md` §12).
**ADRs (new, to record):**

- **ADR-CCCC** — File-type identification as a second capability of the untrusted-byte scan subsystem: a Magika (ML) content-type engine co-located in the scan Container behind its own route, returning **raw identification facts**; the app computes the extension-match verdict and recommendation. Records the engine choice (Magika over a hand-maintained signature table or `file-type`), the placement (co-located in scan, with a measured-trigger extraction seam), and the determinism caveat.

A law firm constantly receives files whose **name lies about their content** — a `contract.pdf` that is really a JPEG, an extension-less export, an executable wearing a document's clothes. This design adds an ethereal Tools-area utility — **File Type Verifier** — that reads a file's _true_ type from its content, compares it to the type the filename claims, and (when the extension is missing or wrong) recommends the correct one. It is built core-first so the same engine can later back a matter-action ("identify every file in this production", "flag type-spoofing on ingest"), per the Tools-area principle: _do matter-grade work without committing it to a matter._

This is **not a separate Tool grafted onto scanning** — file-type identification _is a kind of scan_ (an identity/spoofing check over untrusted bytes), so it lives in the same subsystem and shares its containment posture.

---

## 0. Why Magika, and why in the scan subsystem

**Engine — Magika, not a hand-rolled table or `file-type`.** Magic-byte tables (and the `file-type` npm package, ~150 binary formats) cannot identify **text-based content** — `.txt`, `.csv`, `.json`, source code have no signature bytes, so a signature detector reports them as "unknown". Google's **Magika** is an ML content-type detector covering **200+ types including text and source code** (Python, JavaScript, TypeScript, CSV, JSON, Markdown, …) at ~99% precision, with a few-MB model. It closes the text gap that defeats every signature table, in one engine. The Magika Rust crate performs inference via `ort`/ONNX Runtime (C++) — an owner-consented golden-rule-14 exception contained in the sealed scan container (ONNX Runtime fetched at build time, statically linked, no runtime egress) — a natural fit for the existing Rust scan service.

The trade-off is that Magika is **probabilistic**, not deterministic. The report therefore always carries a **confidence score**, and the UI presents identification as a high-confidence finding, not an unqualified fact — the same reliability discipline the Metadata design drew between its deterministic scrubber and a probabilistic forensics tool. A single trusted engine (no second deterministic detector bolted alongside) keeps the system simple; the score is the hedge, not a fallback engine.

**Placement — co-located in the scan subsystem.** Scored against the extraction rubric (`docs/conventions/operations.md` §12), Magika is ① a heavy native runtime, ④ processes untrusted bytes wanting `enableInternet = false` / no public surface, and ⑤ holds no firm state — the same profile as malware scanning. The rubric permits grouping classes into one Worker when they "share one pipeline and deploy cadence"; scan and identify are one _analyze-untrusted-bytes_ pipeline with identical containment, and Magika simply rides the scan image's existing rebuild. Co-locating reuses the already-warm container instance (no second `standard-1` bill) and exploits a real synergy: **knowing the true type improves malware analysis.** It is built as its own route/module inside the scan service so it can be lifted into a dedicated worker later if its cadence or scaling diverges — the measured-trigger extraction the rubric anticipates (§8).

## 1. Module placement

- **`@magna-carta/file-type`** — new **pure** TypeScript package. No D1, no Hono, no `env`, no Svelte, no network — fully unit-testable. Files:
  - `src/raw.ts` — `RawIdentifyResult` (the container's verbatim Magika output: content-type label, score, group, `magikaVersion`, `modelVersion`).
  - `src/report.ts` — `FileTypeReport` / the build logic: `buildFileTypeReport(raw, filename)` computes the extension comparison and recommendation.
  - `src/labels.ts` — the Magika-label → human-label + canonical-extension(s) table (the only thing we maintain; small, data-only).
  - `src/index.ts` — exports.
  - Dependencies: none (pure). It maps raw facts to a report; it does **not** detect.
- **`containers/scan`** (the Rust scan service) — a new `identify` module (sibling to `clamav.rs` / `yara.rs`) wrapping the Magika Rust crate, plus a route in `lib.rs`'s router. The Magika model is baked into the image at build time (no runtime download, no egress). Mirrors the scan engines' raw-facts shape: it returns identification facts, it does not decide.
- **`apps/scan-worker`** — a new `/identify` route in `src/index.ts` and a `forward-identify.ts` mirroring `forward-scan.ts` (stream the body to the container, return the raw JSON verbatim). No new container class, binding, or cron — it reuses `ScanContainer`, the warm-poke, and the service-binding trust boundary.
- **`apps/worker`** (the app Worker) — a new route module through the chokepoint (§5); calls the scan-worker via the existing service binding, runs `buildFileTypeReport` on the raw result, returns the `FileTypeReport`. Plus a migration seeding the permission.
- **`@magna-carta/tools`** — one new catalog row (§5); no logic.
- **`@magna-carta/access-control`** — one new `tools:fileTypeVerifier` permission.
- **The shell (design-system / web app)** — the `id → Svelte entry component` map and the widget UI; lands with the design-system Tools shell, as the other file tools do. Until then the route is exercised via the throwaway `/__dev` demo page.

Direction: `file-type` (pure) ← app Worker route ← shell; the app Worker → scan-worker (service binding) → scan Container. `file-type` depends on nothing.

## 2. Architecture — raw facts in the container, verdict in the app

This mirrors the scan subsystem's established split (the container returns `RawScanResult`; the app computes the verdict), so the testable decision logic stays in TypeScript and the container stays a thin engine:

```
app Worker  POST /api/v1/file-type/verify
  └─ permission + size cap, stream bytes ─▶ scan-worker /identify
        └─ forward ─▶ scan Container (Magika, no egress) ─▶ RawIdentifyResult
  ◀─ buildFileTypeReport(raw, filename) ─ FileTypeReport (JSON)
```

- **Container (Rust + Magika):** runs the model over the bytes, returns `RawIdentifyResult` = `{ label, score, group, magikaVersion, modelVersion }`. No comparison, no recommendation — raw facts only.
- **App (`@magna-carta/file-type`):** `buildFileTypeReport` maps the label to a human label + canonical extension(s) (`labels.ts`), compares against the filename's claimed extension, and produces the recommendation. Pure, deterministic given the raw input, unit-tested in-isolate.

**Engine-version separability.** `RawIdentifyResult` carries the Magika **engine version and model version** separately (echoing the scan engine's need for separable engine/ruleset/signature versions). This lets a future re-identify-after-model-update and audit reason about _which_ model produced a finding, without entangling it with the scan engine's own versions.

## 3. What gets identified

Magika's content-type set (200+), spanning what a firm actually receives:

- **Documents:** PDF, OOXML (`docx`/`xlsx`/`pptx`), legacy OLE (`doc`/`xls`/`ppt`), RTF.
- **Images:** JPEG, PNG, GIF, TIFF, BMP, WEBP, HEIC.
- **Archives:** ZIP, 7z, RAR, gzip, tar.
- **Text & source (the gap a signature table cannot fill):** plain text, CSV, JSON, XML, Markdown, HTML, and source/code types.
- **Security-relevant:** executables (PE/`exe`, ELF, Mach-O), scripts.

Each identification carries Magika's **group** (e.g. document / image / archive / code / executable) and **score**.

## 4. Behaviour & data model

```ts
interface FileTypeReport {
  detected: string; // Magika content-type label, e.g. "pdf", "python", "jpeg"
  detectedLabel: string; // human label, e.g. "PDF document", "Python source", "JPEG image"
  group: string; // Magika group: document | image | archive | code | executable | text | …
  confidence: number; // Magika score, 0..1 — always surfaced (probabilistic engine)
  claimedExtension: string | null; // from the filename, lowercased; null if none
  extensionMatch: "match" | "mismatch" | "unverifiable" | "no-extension";
  recommendedExtensions: readonly string[]; // canonical extension(s) for the detected type
  note: string; // plain explanation, especially on mismatch / no-extension
}
```

- **match** — claimed extension is canonical for the detected type. (`report.pdf` is a PDF.)
- **mismatch** — the headline security signal: claimed extension disagrees with content. (`contract.pdf` is a JPEG → note the real type, recommend `jpg`.)
- **no-extension** — the filename carries no extension: not an error, a **recommendation** opportunity. (Content is PNG → recommend `png`, suggest `report.png`.)
- **unverifiable** — Magika returns no usable type (rare). Report it plainly; no false mismatch.

Nothing is persisted — the tool is stateless and record-less (the ethereal principle). The two entry points — a file **uploaded** to the Tools surface and (future seam, §8) a file **already in R2** as a matter document — converge on the same `/identify` path; only the byte source differs.

## 5. Surfaces

**App Worker**, through the chokepoint with full `RouteMeta`:

- `POST /api/v1/file-type/verify` — accepts an uploaded file, returns `FileTypeReport` JSON. Permission `tools:fileTypeVerifier`, `resource: "firm"`, no matter binding. Single call (identification has no transform, so no double-upload).

**scan-worker:** `POST /identify` (internal, service-binding only) — `forward-identify.ts` streams the body to `ScanContainer` and returns `RawIdentifyResult` verbatim, mirroring `/scan`.

**Catalog row** in `@magna-carta/tools` (mirrors `file-hash-integrity`):

```
id: "file-type-verifier", name: "File Type Verifier", icon: "file-check",
subjectGroup: "documents", permission: tools:fileTypeVerifier, contextTags: ["file", "none"],
backing: { kind: "library" }, matterContext: "none"
```

`backing: "library"` is correct: this is a first-party capability reached through our own API, not an external integration with credentials (the catalog draws that line only). `matterContext: "none"` now; the seam to `optional` (identify an R2 file, attach the finding to a matter) is the future matter-action consumer of the same core.

## 6. Security

- **Untrusted bytes never reach the network:** identification runs in the scan Container, which already runs with `enableInternet = false`. The model is baked at build time — no runtime fetch.
- **Size cap** on the input, enforced in the app Worker before forwarding, aligned with the scan subsystem's inspectable cap.
- **Redaction by default** (golden rule 4): file bytes, the filename, and the detected content are **never** logged; errors correlate by ID only. Processing is in-memory; nothing is written to R2 or D1.
- **Trust boundary** is the service binding: the scan-worker `/identify` route has no public surface and is reachable only from the app Worker, exactly as `/scan`.

## 7. Testing

- **Pure package (`@magna-carta/file-type`):** unit tests over `buildFileTypeReport` with representative `RawIdentifyResult` + filename pairs → assert each `extensionMatch` state and the recommendation: a PDF named `.pdf` (match), a JPEG named `.pdf` (mismatch → recommend `jpg`), a PNG with no extension (no-extension → recommend `png`), a CSV (text content-type identified), an unverifiable result (no false mismatch). The label/extension table is asserted total over the labels we map.
- **Container + scan-worker integration:** CI/deploy-gated, like scan — the Container binding cannot run in the local Vitest worker pool (the same gap `apps/scan-worker` already lives with). Fixtures per group, including a renamed-extension masquerade and an extension-less file.
- **App Worker route:** Vitest worker pool with the scan-worker service binding mocked to return a known `RawIdentifyResult` — happy path, permission gating, and size-cap refusal.

## 8. Out of scope / future seams

- **Extraction to a dedicated worker** — built as its own route/module inside the scan service so it can be lifted into a `magna-carta-file-type` worker (the rubric's default) if its deploy cadence or scaling later diverges from scanning. Measured-trigger, per `operations.md` §12.
- **Character-encoding detection** — Magika identifies the _content type_ (e.g. "CSV"), not the charset. A `chardet`-class encoding read is a deferred nicety, added only if the UI needs to display it.
- **Matter-action consumer** — "identify this R2 file" / "flag type-spoofing on ingest", consuming the same `/identify` against R2 bytes (no re-upload); flips this tool's `matterContext` seam to `optional`. Type-spoofing detection is a natural input to the scan verdict.
- **Confidence-threshold UX** — how low a score becomes "uncertain" in the UI is tuned when the widget lands with the shell.
- **Re-identify after model update** — enabled by the separable `modelVersion` in `RawIdentifyResult`; the policy (when to re-run) is not designed here.

## 9. Decisions recorded & docs to update

New ADR fragment (`docs/decisions/pending/`): **ADR-CCCC** (file-type identification as a co-located second capability of the scan subsystem; Magika engine; raw-facts-in-container / verdict-in-app split; probabilistic-with-confidence framing). Cite the extraction rubric by path, not by ADR.

On build: a new slice/cross-cutting row in `ROADMAP.md` + `STATUS.md`, and a `changelog.d/` fragment — same commit as the work (golden rule 5). User docs (`docs/user/`) begin when the Tools surface ships (the 0·7a/0·7b precedent). The load-profile accretion rule does not bind — identification is stateless compute, not per-firm data.
