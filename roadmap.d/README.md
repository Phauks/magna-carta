# Feature-ledger fragments — the roadmap's source of truth

**Single home for:** the feature-ledger fragment format. One file per product **area** (mirroring the white paper's areas); each file holds a flat list of feature/sub-feature **nodes** with a status. `roadmap-build` (follow-up slice; design in [`docs/specs/2026-07-14-docs-sync-routine-design.md`](../docs/specs/2026-07-14-docs-sync-routine-design.md)) renders the set into `ROADMAP.md` (human tree view + a small hand-authored narrative header) and `roadmap.json` (machine view — the future interactive/public roadmap consumes this, never the Markdown).

**Division of homes (no duplication):** the [white paper](../docs/Magna-Carta-White-Paper.md) owns the narrative — what each feature is and why. `status.d/` owns slice-stage tracking (execution units). This ledger owns exactly one new fact per node: **how complete the capability is**, plus links. `scope:` is a one-line index entry, not a design description.

## Maintenance rules

- **Docs-in-commit:** a PR that ships or advances a feature flips its node's `status` (and `evidence`) in the same commit — the same definition-of-done rule as changelog fragments.
- **Fragments persist** (like `status.d/`, unlike `changelog.d/`): nodes are never consumed, only updated. Ids are **stable forever** — never renumbered, never reused; a renamed feature keeps its id.
- **Append new capabilities as new nodes** — the ledger grows over time; a promise that will not be kept is flipped to `cut` with a note, not deleted.
- One file per area keeps parallel branches from colliding; two streams rarely ship into the same area at once.
- The weekly docs-sync routine audits merges that advanced a feature without flipping its node, and proposes the flip.

## Node format

A file starts with `# <Area Title>` and an HTML comment, then a flat list of blocks (blank line between). Hierarchy is encoded in the dotted `id`, not by indentation — parsing stays dependency-free:

```markdown
- id: documents.pdf.redaction
  name: PDF redaction
  scope: True content-removing redaction via the rasterize route
  status: shipped
  slices: 2-5-pdf-services-e-signature-core
  adrs: ADR-0134
  spec: docs/specs/2026-06-30-pdf-redaction-design.md
  evidence: crates/pdf-core redaction module + worker route
  audience: public
  notes: Text-preserving surgery route shipped separately
```

| Key        | Required | Meaning                                                                                         |
| ---------- | -------- | ----------------------------------------------------------------------------------------------- |
| `id`       | yes      | Dotted kebab-case path; the segment count is the tree depth; stable forever                     |
| `name`     | yes      | Short display name                                                                              |
| `scope`    | yes      | One factual line — an index entry, not prose                                                    |
| `status`   | yes      | See vocabulary below                                                                            |
| `slices`   | no       | Comma-separated `status.d/` slugs this capability's build is tracked under                      |
| `adrs`     | no       | Comma-separated `ADR-NNNN` (must exist in `docs/decisions/`)                                    |
| `spec`     | no       | One `docs/specs/` path                                                                          |
| `evidence` | no       | One line naming the artifact that justifies the status (package, crate, route)                  |
| `audience` | no       | `public` or `internal` (default) — the public-roadmap filter; reserved until the public surface |
| `notes`    | no       | One line of qualification                                                                       |

## Status vocabulary

| Status        | Meaning                                                                                |
| ------------- | -------------------------------------------------------------------------------------- |
| `shipped`     | The artifact exists on `main` (backend-only counts, with a note, until UI is promised) |
| `partial`     | Parent node whose children mix shipped and not — or a capability delivered in part     |
| `in-build`    | Active work on a branch/worktree right now                                             |
| `designed`    | Accepted design spec exists; no code                                                   |
| `planned`     | Implementation plan exists; build not started                                          |
| `researching` | A named open research workstream                                                       |
| `not-started` | Promised in the white paper; no artifact or spec yet                                   |
| `deferred`    | Explicitly parked by a decision (say which, in `notes` or `adrs`)                      |
| `cut`         | Explicitly dropped by a decision — kept for the record, never deleted                  |

**Initial population (2026-07-14):** extracted from the white paper and statused against the [verified baseline](../docs/maintenance/reports/2026-07-14-baseline.md); statuses are evidence-backed drafts pending owner review in the setup PR.
