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
| **LibreOffice headless** | Office (DOCX/XLSX/PPTX/ODF/legacy) ↔ PDF, and inter-office | **Launch spine — buildable now** | Same LibreOffice core as Collabora (2·2). Runtime survey + the concurrency/font findings in §5. No other-slice dependency. |
| **email → PDF** | MSG/EML → PDF (exhibits) | **Launch spine — buildable now** | High litigation value. Pipeline + library survey firmed up below (2026-06-21). Render step has a real fidelity-vs-roster-weight choice + a network-isolation requirement. |
| **libvips** | images; image ↔ PDF (raster) | **Fast-follow** | Mature; ImageMagick fallback per the published design. Low risk; deferred only to keep the first build tight. |
| **FFmpeg (self-hosted)** | audio/video transcodes | **Fast-follow** | Same engine slated for inline-preview transcoding (2·3 deferred path); lands when that substrate is warm. |
| **PDF engine** | scanned-PDF structure, PDF as a conversion endpoint | **⟦SEAM⟧ — named port, recipe deferred** | Rides the in-flight **pure-Rust PDF engine** (succeeds the PDFium fork). The registry carries the edge; the engine binding fills in when that engine lands. No PDFium/`embedpdf`-era naming bleeds into the conversion design. |
| **OCR (scanned → searchable PDF)** | image/scanned-PDF → searchable PDF | **⟦SEAM⟧ — named port, recipe deferred** | Rides Phase-5 Discovery's OCR engine (PaddleOCR PP-OCRv5 via ONNX/`ort`), which is **not built yet** — this path cannot run until it lands. Modelled now, bound later. |

### email → PDF — library survey (2026-06-21)

Three-stage pipeline: **parse → normalize to print-HTML → render to PDF**. Findings, with the
owner's compiled-language preference applied (freshness re-confirmed at build time, golden rule 11):

**Stage 1 — parse.**

- **EML / MIME → `mail-parser`** (Stalwart Labs). **Adopt.** 100% safe Rust, **no external
  dependencies**, conforms to RFC 5322 + MIME (RFC 2045–2049) and many messaging RFCs, and returns a
  *human-friendly* shape (text parts / HTML parts / attachments) instead of a raw nested MIME tree —
  it even synthesizes the missing HTML-or-text alternative automatically. Runs in production in the
  Stalwart Mail Server; **last published 2026-02-14** (actively maintained). This is the same library
  family already favored elsewhere for MIME work.
- **MSG (Outlook OLE compound) → `msg_parser`** (`marirs/msg-parser-rs`). **Candidate — audit
  maintenance before relying.** Pure Rust, follows MS-OXMSG / MS-OXPROPS, extracts From/To/Cc/Bcc/
  Subject/Date, plain-text **and** HTML bodies (incl. **compressed-RTF decompression** when only RTF
  is present), attachments with raw bytes, SMTP transport headers, and MAPI named properties — i.e.
  everything the render step needs. But it's a single-maintainer port and the published-date/activity
  signal was inconclusive this pass, so treat it as **load-bearing-needs-audit** (the same posture
  the malware research took toward `oletools_rs`): confirm coverage + maintenance at design time, with
  "decompress RTF → HTML" as the fallback path if its HTML extraction has gaps.

**Stage 2 — normalize to print-HTML.** Build one canonical document: a header block (From/To/Cc/
Subject/Date/Message-ID), the body (prefer the HTML part, fall back to text), inline images resolved
**only** from the message's own embedded CID parts, and an attachments policy (embed each in its
original format vs append/convert them as trailing pages — make it a per-job option, mirroring the
existing save-vs-download choice).

**Stage 3 — render print-HTML → PDF. Two real constraints surfaced:**

1. **Do NOT use `wkhtmltopdf`** — the route most off-the-shelf email→PDF tools take. It was **archived
   in Jan 2023, declared unmaintained in Jul 2024**, and carries **CVE-2022-35583 (CVSS 9.8): an
   injected `<iframe>` in user-supplied HTML triggers server-side request forgery** reaching internal
   metadata endpoints. Email HTML is untrusted, externally-originated content — this is exactly the
   threat. Adopting it would import a critical hole.
2. **The render must run network-isolated** — no outbound fetch of any kind (remote images, external
   CSS, iframes); inline only the message's own CID parts. This is the same untrusted-bytes posture as
   slice 2·3's safe-delivery sandbox, applied at *generation* time, and it neutralizes the SSRF class
   above regardless of engine.

   Under those constraints the in-tenant render choice is a **fidelity-vs-roster-weight trade**, to
   settle in design:
   - **LibreOffice headless** — already in the roster (zero new engine), renders HTML→PDF, but modern
     HTML/CSS-email fidelity is mediocre.
   - **Headless Chromium** (Gotenberg-style) — best HTML/CSS-email fidelity, but adds a browser engine
     to the Container roster and costs ~6–11× the CPU/RAM of a lightweight renderer.
   - **The in-flight Rust PDF engine** is a PDF *writer/parser*, not an HTML layout engine, so it is
     **not** a drop-in HTML→PDF renderer unless paired with an HTML layout stage — note it, don't bank
     on it.

   **Lean:** start on **LibreOffice headless** (no new engine, ships the spine) and only escalate to a
   network-isolated headless-Chromium renderer if exhibit-fidelity demands it — a clean fast-follow,
   not a launch blocker.

## 5. Office ↔ PDF — LibreOffice runtime survey (2026-06-21)

LibreOffice and Collabora are **not** the same thing: LibreOffice is the conversion-capable office
suite; **Collabora Online** (the `coolwsd` daemon 2·2 uses) is a *browser-based collaborative
editing* server built **on top of** the same LibreOffice core — the WOPI tier the owner isolated to
one container per open document. They share the core (identical conversion fidelity), so the choice
is purely *which runtime* 2·4 calls. Three real options:

- **(A) Standalone headless `soffice --headless --convert-to`** in a conversion Container — keeps
  conversion off the interactive editing tier; conversion load never competes with live editing.
- **(B) Collabora's `/cool/convert-to` REST endpoint** — **confirmed real**:
  `curl -F "data=@in.docx" https://host:9980/cool/convert-to/pdf > out.pdf` (input auto-detected,
  `-F format=` sets output). Collabora documents this path as **more reliable than driving headless
  LibreOffice over remote UNO, and more secure because each conversion runs in an isolated
  environment** — i.e. it hands you the isolation/reliability for free, at the cost of coupling
  conversion to the editing tier's container model.
- **(C) LibreOfficeKit (LOK)** — the programmatic C++ conversion interface (a **Rust binding exists**,
  `jacobtread/libreofficekit`); The Document Foundation now promotes LOK for conversion. Best
  performance and error-handling, fits the Rust-leaning stack, but the most integration work.

**Two findings that bind regardless of option:**

1. **Concurrency: one conversion per LibreOffice instance.** `soffice --convert-to` **fails silently
   on concurrent requests from one user profile** (profile-lock contention — the second request
   produces no output and reports no error); LibreOffice is **single-threaded per instance**. You
   scale by **isolated instances**, not threads: either a per-conversion isolated `UserInstallation`
   profile, or one instance per Container fanned out behind the queue. This is not a problem for us —
   it **aligns exactly** with the DO-per-job + Container model and 2·2's per-document isolation
   philosophy. Option (B)/(C) handle the isolation internally; option (A) must set an isolated profile
   per job. **It does mean the inline (in-band, "feels instant") path cannot share one warm soffice
   across requests** — size the warm pool as N isolated instances.
2. **Fidelity: bundle Carlito + Caladea fonts.** Without them, LibreOffice substitutes the ubiquitous
   MS Office defaults (Calibri/Cambria) with Liberation fonts and **layout shifts**; Carlito/Caladea
   are metrically-compatible replacements that preserve layout. The conversion Container image **must
   ship a broad font set incl. Carlito + Caladea** — a concrete build requirement for faithful
   DOCX→PDF, not a nicety.

**Recommendation to confirm in design:** **(A) standalone headless with per-job isolated profiles**
as the default — cleanest decoupling from the editing tier and full control of the warm pool — with
**(B) Collabora `convert-to` as the credible fallback** if running a second LibreOffice runtime
proves wasteful (it gives isolation/reliability for free). **(C) LOK-via-Rust** is the
performance-ceiling option to revisit if conversion volume justifies the integration cost. Either
way, the Container ships Carlito + Caladea.

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
- **email → PDF residuals** (survey done 2026-06-21, §4): **audit `msg_parser` maintenance/coverage**
  (load-bearing-needs-audit) and **choose the render engine** — LibreOffice headless (recommended
  start) vs a network-isolated headless-Chromium renderer if exhibit fidelity demands it. `mail-parser`
  for EML is settled. The render step **must be network-isolated** and **must not use `wkhtmltopdf`**.
- **Substrate items inherited from 2·1** — per-tenant fairness, warm-pool sizing, caps; and the
  inline-vs-Container threshold against the load-profile harness.
- **LibreOffice runtime** (survey done 2026-06-21, §5) — confirm the runtime among standalone headless
  + per-job isolated profiles (recommended), Collabora `/cool/convert-to` (fallback), or LOK-via-Rust;
  **bind the build requirement to ship Carlito + Caladea fonts** in the conversion Container, and size
  the warm pool as N isolated single-threaded instances (one conversion per instance).
