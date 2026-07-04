# Document-engine validation harness — design

Status: design (approved; building phase 1) · Owner: PDF engine · Date: 2026-07-03

Phase 1 scope: the engine-wide harness frame proven end to end on the **forms**
operation over a small set of **pdf.js form-file URLs**. Remaining operations
(render, redact, scrub, detect, generate, secure), **OCR**, broader corpus sources,
and the Worker tier follow on the same frame — see Phasing.

## Motivation

The pure-Rust PDF engine (`crates/pdf-core`) now ships many operations — render,
text-preserving redaction (surgery), scrub, bad-redaction detection, AcroForm
read/fill/flatten, generate (merge/split/rotate/watermark), Bates, and
secure/encrypt. Confidence in each rests today on a ~10-file eval corpus. That is
enough to prove a feature works; it is not enough to *trust* the engine against
the messy, adversarial, internationally-diverse documents real firms will bring.

We want a **durable, reusable validation apparatus**: run any engine operation
over a large corpus of real and pathological documents and answer three questions
at once —

1. **Robustness** — does it ever panic, hang, or crash on untrusted input?
2. **Safety** — when an operation claims success, is its safety invariant truly
   upheld (e.g. a redacted region contains no recoverable text)?
3. **Coverage** — how often does the good path fire versus a safe fallback, and
   *why* does it fall back?

The apparatus is not a one-off measurement. It is re-run as the engine evolves,
tracks regressions against a committed baseline, and is structured so the same
core serves every PDF operation now and a parallel harness for the Collabora
editing engine later.

## Goals

- One harness that validates **any** engine operation, not just redaction.
- **Robustness, safety, and coverage** from a single corpus run.
- **Reproducible corpus**: a committed manifest (license + source + checksum per
  file); the documents themselves fetched locally, never committed.
- **Regression tracking**: a committed baseline and a diff that flags new panics,
  new hangs, safety-invariant violations, and coverage regressions.
- **Reusable core**: corpus, runner, reporting, and regression logic are
  operation-agnostic and, by structure, engine-agnostic (Collabora-ready).

## Non-goals

- Not a per-push CI gate over the large corpus. The large corpus is gitignored and
  the run is minutes-scale; the committed `corpus-ci` smoke stays the push gate.
  The large-corpus run is periodic/on-demand.
- Not the Collabora harness itself — only the seam that lets one be built later
  without reworking this one.
- Not a dedicated fuzzing campaign. The adversarial mega-corpora (UNSAFE-DOCS,
  Qiqqa Evil Base, SafeDocs Issue Tracker) are a later, separate effort; this
  design accommodates a modest adversarial slice, not millions of mutations.
- Not a performance/load harness. Throughput and latency are governed separately
  by the load-profile fixtures (see the white paper, _Performance & concurrency
  model_).

## Architecture

The harness is four operation-agnostic pieces plus a set of per-operation plug-ins.

### 1. Corpus — manifest-driven, license-tracked

**Phase 1 keeps this deliberately light.** The first slice references a handful of
pdf.js form-file URLs directly. Those files are direct-committed `.pdf`s in
`mozilla/pdf.js` (not the rot-prone `.pdf.link` external pointers) and are treated
as stable, so a sha256 pin and a local cache are *optional conveniences* (recorded
for drift-detection, never a hard gate) rather than required infrastructure. New or
changed pdf.js files are fine — the harness simply tests whatever the manifest
points at. The fuller manifest rigor below applies only when we later add larger,
less-trusted, or archive-based sources (govdocs1, SafeDocs), where reproducibility
must be pinned.

Extend the existing `crates/pdf-eval/corpus.lock` convention with a larger
manifest, `corpus-large.lock`. Each entry records: sha256, byte size, filename,
**license**, source URL, and one or more **category** tags
(`gov-form`, `legal-filing`, `govdocs1-sample`, `pdfjs-edge`, `safedocs-stress`,
`verapdf-feature`, `pdf20`, `international`, …).

A fetch step (`pdf-eval corpus-fetch`) downloads each entry into a gitignored
`crates/pdf-eval/corpus-large/`, verifying sha256 on arrival. The manifest is the
committed, reusable asset; the PDFs are regenerated from it and never committed.
Only clearly-redistributable files graduate to the committed `corpus-ci`.

Sourcing is public-domain or permissively-licensed only (a redaction tool must not
ingest documents it cannot redistribute or that carry third-party PII). The fuller
starter set (~300–400 files, phase 2+) draws from:

| Source | License | Contributes |
| --- | --- | --- |
| Mozilla pdf.js `test/pdfs` | Apache-2.0 (project) | edge cases, fuzzed files, fonts incl. CJK/Arabic, annotations, compression |
| SafeDocs "Targeted Test PDFs" | Apache-2.0 | hand-coded parser stressors |
| veraPDF corpus | Open | PDF/A · PDF/UA · ISO 32000 feature files (atomic per clause) |
| pdf20examples | Open | PDF 2.0 features |
| Isartor / BFO / PDF-UA reference | Open | conformance failure conditions |
| GovDocs1 (digitalcorpora) | Open | ~50–100 messy real-world sample |
| Gov forms/filings (uscourts, IRS, GPO) | Public domain | target-domain: legal, AcroForms |

Proprietary suites (Ghent GWG, Altona) are excluded. The manifest records the
per-file license so provenance is auditable.

### 2. Validation operation — the plug-in interface

The single abstraction that makes the harness engine-wide:

```
ValidationOperation:
  name() -> &str
  run(bytes) -> OperationResult          // may panic; the runner isolates it
  classify(result) -> Outcome            // Success{variant} | Fallback | Skipped | Error
  check_safety(bytes, result) -> Safety  // Upheld | Violated{detail} | NotApplicable
```

Each engine capability implements it. **Forms is the phase-1 pilot** — it proves
the whole frame on one operation; the rest follow on the same interface. **OCR is a
planned future operation** (once the OCR engine lands) and drops into this same
interface with no harness change — a key reason the abstraction is worth building
now.

| Operation | Phase | Outcome variants | Safety invariant |
| --- | --- | --- | --- |
| **forms (read/fill/flatten)** | **1 (pilot)** | Success / Error | filled field values read back from the output |
| render | 2 | Success / Error | — (read-only) |
| redact (surgery) | 2 | surgered / flattened / skipped(no-text) | redacted region text-free — re-run `Document::page_text_rects` on the **output** over the redaction rect; must be empty |
| scrub | 2 | Success / Error | supplied target strings absent from output bytes |
| detect | 2 | Success / Error | — |
| generate (merge/split/rotate/watermark) | 2 | Success / Error | output re-parses as a valid PDF |
| secure (encrypt / decrypt) | 2 | Success / Error | decrypt(encrypt(x)) round-trips |
| **OCR** | 3 (future) | text-extracted / no-text / Error | — (read-only; optionally: extracted text matches a fixture expectation) |

The safety check for redaction is deliberately **self-contained** — it reuses the
engine's own `page_text_rects` on the produced output, so every surgered document
is independently confirmed text-free with zero external tooling, not just a
sample. Other operations define their invariant analogously or declare it
`NotApplicable`.

### 3. Runner — robustness by construction

For each (operation × document): execute `run` inside `std::panic::catch_unwind`
under a wall-clock timeout. A panic or a timeout is **recorded against that file**
and the run continues — the harness never aborts on a bad document. Per document
the runner emits: operation, category tags, outcome, safety verdict, wall time,
and — for a fallback — the reason (see §5).

Outcome taxonomy: `Success{variant}` · `Fallback` · `Skipped` · `Error` ·
`Panicked` · `TimedOut`. `Panicked` and `TimedOut` are robustness defects and must
stay at zero; anything else is a coverage/behaviour signal.

### 4. Reporting and regression tracking

Each run writes a per-document report (`JSONL`) and a summary: outcome
distribution and fallback-reason histogram, broken down by operation and by
category, plus the explicit list of any `Panicked` / `TimedOut` / safety-`Violated`
files.

A committed baseline (`crates/pdf-eval/validation-baseline.json`) captures the
expected summary — counts, reason histogram, and the (empty) defect lists. A
re-run diffs against it and **fails** on: any new `Panicked`/`TimedOut`, any safety
`Violated`, an outcome regression on a tracked document (e.g. surgered→flattened),
or a coverage drop beyond a configured threshold. `--update-baseline` refreshes it
deliberately. For the gitignored large corpus the baseline is summary-level (counts
and histograms keyed by category, since per-file results are not committed); for
the committed `corpus-ci` subset the baseline can pin per-file expectations and act
as a real gate.

### 5. Enabling change in `pdf-core` — fallback reasons

To populate the fallback-reason histogram, `redact` (and analogous operations)
must report *why* a page took the safe fallback. Add a small reason enum to the
redaction report — `FontUnsupported`, `ImageOverlap`, `Rotation`, `RoundTrip`,
`GateRejected` — surfaced per flattened page. This is a minor, self-contained
addition and is independently useful: a consumer UI can tell a user "couldn't
preserve text: rotated page" rather than a bare fallback.

## Execution tiers

**Tier 1 — native batch (primary).** The `pdf-eval` binary runs the whole corpus
natively: fast, cheap, full diagnostics, thousands of documents in one process.
Native and WASM run the same Rust logic, so robustness/safety/coverage findings
transfer — with one exception below. This is where the apparatus primarily lives.

**Tier 2 — Worker conformance (a later phase, separable).** Native cannot observe the
Cloudflare Worker resource envelope: the ~128 MB isolate memory ceiling and the
CPU-time limit. A document that surgers fine natively can OOM a Worker (the flatten
path rasterizes pages — millions of pixels). A smaller sample is therefore run
through the **real WASM build under Miniflare**, recording `OOM`/`TimedOut`
alongside the normal outcome. This tier answers a real architectural question:
*do heavy documents fit in a Worker, or does an operation need a Container fallback*
(as editing/conversion/OCR already do)? It is specified here but built later (see
Phasing), so the first delivery stays focused.

## Collabora extension seam

The four core pieces — corpus manifest, runner, reporting, regression — are
engine-agnostic. Collabora runs in a Container over HTTP rather than as a native
Rust call, so it needs its own **operation runner** (invoke the container, classify
the returned document), but it reuses the identical corpus manifest format,
reporting schema, and regression model. The seam is: keep the corpus/report/
regression modules free of any `pdf-core` type, behind the `ValidationOperation`
interface. The reusable core is **not** extracted into a shared crate now — it is
built inside `pdf-eval` with clean internal module boundaries, and lifted to a
shared home only when a second consumer (a `collabora-eval`) actually exists.
Premature extraction for a hypothetical consumer is avoided (golden rule: reuse
before building).

## Where it lives

Built in `crates/pdf-eval` as a new `validate` mode that supersedes the ad-hoc
per-operation smoke modes for corpus-wide runs. Internal modules — `corpus`
(manifest + fetch), `operations` (the plug-ins), `runner`, `report` — are kept
decoupled so `corpus`/`runner`/`report` carry no `pdf-core` dependency in their
signatures, satisfying the Collabora seam.

## Testing the harness itself

- Unit tests for outcome classification and the regression diff (fixture summaries
  in and out).
- The redaction safety check is validated by construction against known-good and
  known-leaky inputs (the existing `surgery_flattens_when_text_is_only_in_a_form_xobject`
  fixture and its inverse).
- A tiny committed sub-corpus (from `corpus-ci`) gives a deterministic smoke run of
  the whole apparatus without the large fetch.

## Phasing

1. **Phase 1 (first slice — this build):** the harness frame proven end to end on
   ONE operation and ONE source. Build the `ValidationOperation` interface, the
   runner (catch_unwind + timeout), reporting, and the regression baseline — and
   wire up the **forms** plug-in (read/fill/flatten) over a small set of **pdf.js
   form-file URLs** (light manifest, trust-based, no checksum/cache ceremony). This
   is the thin vertical slice that makes the apparatus real and reusable.
2. **Phase 2:** the remaining pdf-core operations (redact, render, scrub, detect,
   generate, secure) on the same frame; the `pdf-core` fallback-reason enum for
   redaction; and the fuller pinned manifest + broader sources
   (SafeDocs/veraPDF/pdf20/gov/govdocs).
3. **Phase 3:** the **OCR** operation once the OCR engine lands — a drop-in on the
   existing interface.
4. **Phase 4 / separate:** Worker conformance tier (Miniflare, 128 MB / CPU
   envelope); adversarial mega-corpus slice; a parallel `collabora-eval` reusing
   the extracted core.

## Decisions to record as ADRs

- Document-engine validation is a manifest-driven, gitignored large corpus with a
  committed license-tracked manifest; only redistributable files are committed.
- The harness is operation-agnostic and engine-agnostic by construction; the
  reusable core is extracted only when a second engine consumes it.
- Two-tier execution: native batch for logic; Worker/Miniflare conformance for the
  Cloudflare resource envelope.

## Open questions

- Baseline granularity for the large gitignored corpus: category-summary only, or
  also pin a curated committed subset per-file? (Leaning: both — summary for the
  large set, per-file for the `corpus-ci` subset.)
- Timeout budget per document for the native tier (proposed default: a few seconds;
  configurable).
- Whether the fetch step lives in `pdf-eval` (Rust) or a small `tooling/` script;
  Rust keeps it in one place and reuses the manifest parser.
