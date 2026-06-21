# In-App File Conversion — Pluggable Engines, Confidentiality-by-Default (Research)

**Date:** 2026-06-21
**Scope:** How the platform should generate file-format conversions (the slice 2·4 deliverable) — the
any-format → any-format converter surfaced in the file manager. Covers the engine model, the format
registry, the engine roster and which paths are buildable now, execution placement, and the
confidentiality posture. Excludes the heavy PDF *manipulation* operations (merge/split/stamp/redact/
Bates) — those are slice 2·5's _PDF services_ and are most affected by the in-flight pure-Rust PDF
engine; 2·4 touches PDF only at conversion *edges* (Office→PDF, image↔PDF, scanned→searchable,
email→PDF).
**Purpose:** Park what this pass established and name the open gates so the eventual 2·4 **design**
cycle starts from evidence rather than a cold start. Input to a future design, **not** a design. The
white paper (_In-app file conversion_) already pins much of the architecture; this doc records the
concrete engine/registry decisions and the one **reframe** of the published stance.
**Status (owner, 2026-06-21): RESEARCH IN PROGRESS — direction shaped; home = slice 2·4.** The full
2·4 design cycle is **gated** on the shared execution substrate landing (2·1's Queue/Container/
Durable-Object orchestration; 2·2's per-document LibreOffice container pattern), so this doc
deliberately *references* that substrate rather than re-deciding it. The headline reframe (in-house-
only → pluggable engines with confidentiality as the default) needs its own ADR and a white-paper
amendment when 2·4 is designed; this doc is the evidence base for that decision, not a substitute.

---

## 0. What the white paper already settled (do not re-litigate)

These come from the published _In-app file conversion_ design and are treated as fixed inputs:

- **Built in-house, surfaced at the file** — right-click → **Convert to…**, the original is never
  mutated (every conversion writes a new object), confidentiality/margin/integration are the stated
  reasons.
- **A unified conversion orchestrator (Worker) over a declarative format registry** — a
  `(source → target) → {engine, recipe}` table with **multi-hop chains** computed when no direct
  path exists. The registry is the single source of format knowledge: it both runs the job and
  answers "what can this file become?", so the **Convert to…** menu is **data-driven**.
- **Hybrid execution** — small jobs in-band (feel instant); large/batch jobs become a tracked
  background job, a **Durable Object per job** holding queued → running → per-item progress → done,
  spinning Containers up on demand and sleeping them when idle (the editing-tier pattern).
- **Output is the user's choice per job** — save into the matter (a versioned R2 sibling,
  audit-logged) or download a copy; download always available alongside.
- **Authorization** — every conversion passes the same matter/role-based-access gate as inline
  preview before any bytes are read.

The open work below is narrower than a fresh slice: it firms up the engine model, the registry's
shape, the roster, and the one stance change.

## 1. The reframe (headline): in-house *by default*, not in-house *only*

The published design frames the converter as **in-house only, by design** — privileged bytes go
R2 → our Container → R2 and **never egress**; CloudConvert/Zamzar-style services were explicitly
rejected on confidentiality grounds.

**Owner intent (2026-06-21): the converter should also be able to use external engines** — an online
office suite (Microsoft 365), Adobe's PDF services, or others — where a firm wants them. That means
privileged client files could leave the tenant, which directly contradicts the published rationale.
The reframe that reconciles the two:

> **In-tenant conversion is the default and the only path for privileged content; external engines
> are a per-firm opt-in, gated per content-class, and egress is a deliberate, governed, consented
> exception — never the default.**

This keeps the confidentiality principle as the structural default (nothing egresses unless a firm
*chose* to enable a vendor *and* the content class permits it) while honoring the intent to support
external engines. It is a real change to the published stance, so the 2·4 design cycle owes:

- an **ADR** recording the in-house-default / external-opt-in model and the egress-consent rule; and
- a **white-paper amendment** to _In-app file conversion_ so the published rationale no longer reads
  as an absolute in-house lock.

## 2. Engine model — ports and adapters (reuse the integration framework)

With external engines in scope, the engine roster stops being a fixed list and becomes a **pluggable
set of engine adapters behind a conversion port**, which is exactly the shape the already-built
`@magna-carta/integrations` framework provides (typed ports, adapters, per-adapter capability
descriptors, registry + typed dispatch, the per-firm connection + credential-store seams).

- **One `ConversionPort`**; in-house Container engines (LibreOffice headless, libvips, FFmpeg) and
  external credentialed engines (Microsoft 365, Adobe) are **peer adapters** behind it — the same
  shape, differing only in where bytes run.
- **Each adapter ships a capability descriptor**: the `(source → target)` edges it covers, its
  fidelity, its cost, and — the new axis — its **confidentiality posture** (`in-tenant` |
  `egress-to-vendor`). The orchestrator reads descriptors; it never hard-codes engine knowledge.
- **External engines reuse the per-firm `integration_connection` + credential-store machinery**
  (built for shipping/EasyPost and seamed for email/calendar). Connecting Adobe is the same act as
  connecting any integration; the firm owns that decision, and the converter enforces the
  in-tenant-default policy on top of it.

This makes "support other engines" an *additive adapter* problem rather than a rewrite, and it puts
both credentialed and credential-less engine types in one registry from the start.

## 3. Format registry + pathfinding — a graph, not a table

The published `(source → target) → {engine, recipe}` table generalizes once an edge can be served by
more than one engine:

- **The registry is a directed graph.** Nodes are formats; an edge `A → B` carries **one or more
  candidate engines**, each with its descriptor (fidelity / cost / confidentiality).
- **Multi-hop chaining** is shortest-path over that graph when no direct edge exists
  (e.g. `WPD → ODT → PDF` via LibreOffice), weightable by fidelity/cost so the orchestrator prefers
  fewer, higher-fidelity hops.
- **Engine selection is policy-driven**, evaluated *after* a path is found: prefer the `in-tenant`
  candidate; choose an `egress-to-vendor` candidate only when the firm has enabled it **and** the
  content class permits egress. Privileged content never selects an egress engine.
- **Per-firm available conversions = the union of the enabled engines' descriptors.** Connect Adobe →
  new edges light up in that firm's **Convert to…** menu; disconnect → they disappear. The menu stays
  data-driven, now per-firm.

**Open design question:** whether the registry is static platform configuration (code, with per-firm
enablement as an overlay) or fully data-backed in D1. Recommendation to evaluate in design: **static
platform-defined edges/recipes with a per-firm enablement + policy overlay** — the format knowledge
is platform-wide and security-sensitive (it drives what runs), while only *enablement* and *policy*
are per-firm.

## 4. Engine roster — concrete where buildable, seamed where not

| Engine family | Edges | Status for the first build | Notes |
| --- | --- | --- | --- |
| **LibreOffice headless** | Office (DOCX/XLSX/PPTX/ODF/legacy) ↔ PDF, and inter-office | **Launch spine — buildable now** | Same LibreOffice core as Collabora (2·2); runtime choice in §5. No other-slice dependency. |
| **email → PDF** | MSG/EML → PDF (exhibits) | **Launch spine — buildable now** | High litigation value. Realistic pipeline + candidate libraries below; freshness to verify at design time (golden rule 11). |
| **libvips** | images; image ↔ PDF (raster) | **Fast-follow** | Mature; ImageMagick fallback per the published design. Low risk; deferred only to keep the first build tight. |
| **FFmpeg (self-hosted)** | audio/video transcodes | **Fast-follow** | Same engine slated for inline-preview transcoding (2·3 deferred path); lands when that substrate is warm. |
| **PDF engine** | scanned-PDF structure, PDF as a conversion endpoint | **⟦SEAM⟧ — named port, recipe deferred** | Rides the in-flight **pure-Rust PDF engine** (succeeds the PDFium fork). The registry carries the edge; the engine binding fills in when that engine lands. No PDFium/`embedpdf`-era naming bleeds into the conversion design. |
| **OCR (scanned → searchable PDF)** | image/scanned-PDF → searchable PDF | **⟦SEAM⟧ — named port, recipe deferred** | Rides Phase-5 Discovery's OCR engine (PaddleOCR PP-OCRv5 via ONNX/`ort`), which is **not built yet** — this path cannot run until it lands. Modelled now, bound later. |

**email → PDF, realistic pipeline (to firm up in design):** parse the message
(EML = MIME; MSG = Outlook OLE compound file) → normalize headers + body + inline parts to a
canonical HTML/print representation → render to PDF; attachments either embedded or surfaced as
separate conversions. Candidate parsers to **verify for freshness/maintenance before adopting**
(golden rule 11), with the owner's compiled-language preference in mind: `mail-parser` (Rust,
Stalwart — strong MIME/RFC coverage) for EML, an MSG/OLE reader for Outlook messages; the
HTML→PDF render step likely reuses an in-tenant engine (LibreOffice or the Rust PDF engine) rather
than introducing a browser. **This library survey is a design-cycle task**, not settled here.

## 5. LibreOffice runtime — same core as Collabora, different runtime

LibreOffice and Collabora are **not** the same thing, and the difference matters for 2·4:

- **LibreOffice headless** (`soffice --headless --convert-to …`, or LibreOfficeKit) is a one-shot,
  non-interactive **conversion** runtime.
- **Collabora Online** (the `coolwsd` daemon used by 2·2) is a *browser-based collaborative editing*
  server built **on top of** the same LibreOffice core — the interactive WOPI tier the owner isolated
  to one container per open document.

They share the LibreOffice core (identical conversion fidelity), so the choice is purely *which
runtime* 2·4 calls:

- **(A) Standalone headless `soffice --convert-to`** in a conversion Container — keeps conversion off
  the interactive editing tier the owner deliberately isolated per-document; conversion load never
  competes with live editing.
- **(B) Route Office conversions through Collabora's `/cool/convert-to` endpoint** — reuses one
  container image, but couples conversion throughput to the editing tier's isolation model.

**Recommendation to confirm in design: (A) standalone headless** — same fidelity, cleaner isolation,
and it keeps the converter's scaling independent of editing. Worth a second look only if operating
two LibreOffice runtimes proves wasteful in practice.

## 6. Execution and the shared substrate — reference, don't re-decide

The hybrid inline / Durable-Object-per-job model is published; the machinery underneath it is **the
same Queue + Container + Durable-Object substrate 2·1 stands up** for the scan pipeline and 2·2 for
editing. 2·4 should **consume** that substrate, not invent its own:

- **Inherit, don't re-solve, 2·1's open substrate items**: per-tenant fairness, warm-pool sizing, and
  file-size / archive caps. These are scanning's open gates today; conversion has the same shape and
  should adopt whatever 2·1 settles.
- **The inline-vs-Container threshold** ("what counts as small?") is a **measurement** decision
  (golden rule 10) — set against the load-profile harness once there's a real conversion mix, not
  guessed up front.
- This dependency is exactly why the **2·4 design cycle is gated** on 2·1/2·2: writing the execution
  spec before that substrate is locked would be writing against a moving target.

## 7. First-build coverage and build order

Anchored on the firm's daily reality and the documents-finished-first spine:

1. **Launch spine (zero other-slice dependency):** **Office ↔ PDF** (LibreOffice headless) and
   **email → PDF** (MSG/EML, for exhibits). These are the everyday legal-practice conversions and
   need no PDF-engine or OCR work.
2. **Fast-follow as substrates settle:** **images / image↔PDF** (libvips), **A/V transcode**
   (FFmpeg, with the preview transcoding path), **scanned → searchable** (OCR, when Phase-5 Discovery
   lands), and **PDF-endpoint edges** (when the Rust PDF engine lands).
3. **External engines** (Microsoft 365, Adobe) are an **opt-in adapter track**, sequenced by demand —
   the in-tenant spine ships first; vendor adapters slot in behind the §1 policy without reshaping the
   orchestrator.

## 8. Output and authorization — carry-forward, not re-litigated

Settled by the published design and reused wholesale: save as a **new file version** in the matter
(through `@magna-carta/file-manager`, audit-logged) or **download**; the original is never mutated;
every conversion passes the **same matter/role-based-access gate as inline preview** before any bytes
are read. Recorded here only so the design cycle treats it as fixed.

## 9. Open items for the 2·4 design cycle

- **The confidentiality-reframe ADR** (in-house default / external opt-in / egress consent) **+ the
  white-paper amendment** to _In-app file conversion_.
- **Registry storage model** — static platform edges + per-firm enablement/policy overlay (recommended)
  vs fully data-backed; the policy-evaluation point in the orchestrator.
- **Engine-selection policy surface** — how a firm enables an external engine and declares which
  content classes may egress; the per-conversion "this leaves our systems" consent UX.
- **The PDF-engine and OCR seam bindings** — fill in the deferred recipes when the pure-Rust PDF
  engine and the Phase-5 Discovery OCR engine land.
- **The email → PDF library survey** — verify and choose the MIME/MSG parsers and the HTML→PDF render
  step (golden rule 11).
- **Substrate items inherited from 2·1** — per-tenant fairness, warm-pool sizing, caps; and the
  inline-vs-Container threshold against the load-profile harness.
- **LibreOffice runtime** — confirm standalone headless vs Collabora `convert-to`.
