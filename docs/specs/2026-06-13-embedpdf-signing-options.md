# EmbedPDF signing (PAdES seal creation) — options analysis

**Status:** Analysis (design discussion; no code spike yet) · **Date:** 2026-06-13 · **Owner:** Trevor Goldsmith
**Relates to:** ADR-0088 §J (signing = the dependency-elimination upstream target) · ADR-0045 (PAdES platform seal, firm key; ESIGN/UETA attribution + Certificate of Completion) · [`2026-06-13-embedpdf-sanitize-completeness-design.md`](2026-06-13-embedpdf-sanitize-completeness-design.md) (signing explicitly out of scope there)
**Deferred:** picked up only **after the sanitization PR lands** (keeps the upstream approval-latency pilot to one clean signal at a time). This note captures the architecture analysis so the eventual feasibility spike starts from a decision, not a blank page.

## The reframe that drives everything

**The cryptographic signing — private key → PKCS#7/CMS — stays host-side in every option.** The firm's signing key (or HSM) never goes into a WASM engine. So "add signing to EmbedPDF" does **not** mean PDFium does the crypto; it means PDFium owns the _PDF structure_ (signature dictionary, `/ByteRange`, `/Contents` placeholder, incremental save) and hands our code a digest to sign. That distinction separates the two options below.

Spike #2 (on file, `pdf-tooling.md`): EmbedPDF/PDFium _verifies_ signatures (`FPDF_GetSignatureCount`/`…Obj_Get*`) but has **no creation API**.

## Option A — external library (`@signpdf`) over EmbedPDF-produced bytes

`@signpdf` is two parts: a **placeholder maker** (adds the signature widget + sig dict + `/ByteRange` + zero-filled `/Contents`, built on pdf-lib) and a **signer** (`signer-p12`, CMS via node-forge).

```ts
// server tier — the PAdES platform seal (ADR-0045, firm key)
const working = await engine.sanitizeDocument(doc);          // EmbedPDF makes the bytes
const withPlaceholder = await addPlaceholder({ pdfBuffer: working, ... }); // @signpdf/pdf-lib
const sealed = await signpdf.sign(withPlaceholder, new P12Signer(firmKeyP12)); // CMS over /ByteRange
await r2.put(matterKey, sealed);
```

- **Deps added:** `@signpdf/signpdf`, `@signpdf/signer-p12`, `@signpdf/placeholder-pdf-lib`, `node-forge`, and **pdf-lib as a runtime dep**.
- **Bytes touched by:** PDFium (content) then **pdf-lib + @signpdf** (placeholder + embed) — **two PDF serializers**, the fragmentation ADR-0088 set out to avoid, and a real correctness risk (incremental-updating a PDFium-saved file with a different library).
- **Pros:** works today; zero upstream dependency; `@signpdf` is battle-tested for PAdES-B-B. **Cons:** two PDF libraries; basic PAdES level (LTV/timestamps need more); the engine fragmentation.

## Option B — in-engine seal creation (EmbedPDF, our fork)

A **prepare → (host signs) → embed** split, because the crypto stays host-side:

```ts
const { bytesToSign, handle } = await engine.prepareSignature(doc, { reason, fieldRect });
const cms = await firmSigner.signDetachedCMS(bytesToSign); // OUR code: WebCrypto / HSM
const sealed = await engine.embedSignature(handle, cms);
```

Backing it: two new `EPDF_*` exports — `EPDF_PrepareSignature` (write sig dict + widget, reserve a fixed-size `/Contents`, set the exact `/ByteRange`, incremental-save, return bytes-to-sign) and `EPDF_EmbedSignature` (splice the CMS into the reserved gap).

- **Eliminates:** `@signpdf`'s PDF-manipulation layer (`placeholder-*` + the incremental embed) **and pdf-lib-for-signing**. **Keeps** a thin host CMS signer — potentially plain **WebCrypto** (could drop node-forge too).
- **Bytes touched by:** **PDFium only**, end-to-end — it knows its own byte layout, so the `/ByteRange` is exact and there's no two-serializer conflict. The "one engine" thesis fully realized.
- **Pros:** single engine owns the bytes; cleaner PAdES correctness; strengthens the engine. **Cons:** substantial, cryptographic-protocol-correctness-sensitive C++; PDFium deliberately omits signing-creation (high merge-uncertainty — but see fork-as-given).

## Fork-as-given (acceptance does not gate)

Per ADR-0088 §J we run our fork regardless of merge ("never gate on the merge; rejected/stalled → keep the patch indefinitely, MIT permits it"). So **merge-acceptance is not a decision factor.** The decision reduces to **in-engine (B) vs. external library (A) on engineering merit**, with the fork as a given. Two consequences:

1. **Fork-maintenance cost is a design choice, not inherent.** If B modifies PDFium's core save path, it rebases painfully on every PDFium re-sync (security-sensitive area upstream changes often). But shaped as an **isolated incremental-append** — append the signature dict as an incremental update to the already-saved bytes, exactly what `@signpdf` does in JS — it barely touches PDFium core → low rebase cost. Prefer the isolated-append shape.
2. **The dependency-elimination motive weakens.** Without counting on a merge, B only ever _partially_ drops `@signpdf` (the PDF-structure part; a thin host signer remains). So the real reason to do B is **"one engine owns the PDF bytes"** (no fragmentation), not "eliminate a dependency." Sharpen the §J framing: "drop `@signpdf`'s PDF-manipulation; keep a thin host signer," not "drop `@signpdf` entirely."

## Placement and product layer (unchanged either way)

Server-tier (the platform seal uses the firm's server key, ADR-0045) — EmbedPDF-in-Node in a Worker/Container. The **ESIGN/UETA attribution workflow + Certificate of Completion + signature verification** stay **ours** in-tree (the product layer, like the redaction verification gate) regardless of A vs B.

## Packaging — signing is its own package (decided 2026-06-13)

Signing lives in a **dedicated package**, not folded into the engine/sanitization code:

- **Our side:** a `@magna-carta/signing` package — the product layer (ESIGN/UETA attribution + Certificate of Completion + signer orchestration + verification), isolated from general PDF/document handling. It is the natural unit for Fable to own/review.
- **Engine side (only if Option B):** a separate EmbedPDF **plugin** (`@embedpdf/plugin-signature`), not engines-core — matches EmbedPDF's plugin architecture and keeps signing off the sanitization code path.

**Why this matters most:** the package boundary **decouples the A-vs-B choice from the rest of the system.** The package exposes a stable interface (e.g. `sealDocument(bytes, options) → sealedBytes`, plus the ESIGN/UETA workflow); whether the internals are `@signpdf` (A) or in-engine `prepareSignature`/`embedSignature` (B) is invisible to consumers. So we **ship A now behind the package interface and swap to B internally later** with zero consumer churn — making the A→B path low-risk and reversible, and the feasibility spike non-blocking.

## Rigor

Signing is legal e-signatures, not a delete-a-key vector → **foundational/financial: Fable builds AND reviews**, with extra rigor (model-split policy).

## The deferred feasibility spike (when signing is picked up)

The question is **not** "will upstream accept it" (fork-as-given). It is:

> **Is the in-engine incremental-signing C++ tractable as an isolated append we can own comfortably — or is `@signpdf` (or a thin WebCrypto signer) over EmbedPDF-produced bytes simply good enough?**

Spike tasks: (1) read `@signpdf`'s placeholder/ByteRange/embed mechanics + its PAdES level; (2) confirm whether PDFium's save can reserve a `/Contents` placeholder + exact `/ByteRange` as an isolated incremental append (vs. touching the core saver); (3) prototype a WebCrypto detached-CMS signer over A as the low-risk baseline; (4) decide A-vs-B on the above. Then design → plan → Fable-built PR.

## Recommendation (current)

Ship signing via **A** first (works now, low risk) to get the capability; treat **B** as the upstream-first aspiration gated on the spike above. Both reuse the fork + CI infra we've stood up; neither blocks the sanitization PR.
