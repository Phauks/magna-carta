---
branch: compliance-baseline
worktree: C:/dev/magna-carta (primary)
area: Compliance control baseline — framework mapping (SOC 2 / GDPR / PCI DSS / ISO 27001) + gap register
status: designing
touches: NEW docs/conventions/compliance.md, docs/conventions/README.md (add row), docs/conventions/security.md (pointer), docs/decisions/pending/ (4 ADR fragments), changelog.d/
---

Establishes the engineering-facing compliance posture as a **control-to-framework map** that builds on the
controls already decided (tenancy isolation, envelope encryption + crypto-shred, RBAC, redact-by-default
telemetry, backup/DR, PCI SAQ A) rather than restating them. Docs-only + ADR fragments — no code. Two ADRs
are `Accepted` (the baseline program; the PCI SAQ-A hosted-modal payment invariant, which refines the white
paper's imprecise "Helcim.js → SAQ A" wording); two are `Proposed` owner-decisions (subject-level erasure /
DSAR, and a per-firm data-residency seam) drawn from the fork research.

Reads across the whole security/compliance surface but **edits only `docs/`**. Cross-cutting touch points a
concurrent stream should know about: adds one row to `docs/conventions/README.md` and one pointer line to
`docs/conventions/security.md`. No source, schema, or STATUS/ROADMAP rows touched. Separate from the
`legal-perimeter.md` owner/legal track (attestation artifacts) — this stream is the engineering control map.
