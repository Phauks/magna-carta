# decision-register-repair

**Branch:** `claude/decision-register-repair` (from `origin/main` @ 59a79039)
**Scope:** repair four degraded decision-register entries, guard the assembler against the shape that
degraded them, and record the owner decisions of 2026-08-04 for document automation and Custodian.
Docs + tooling only — no application code.

## The defect

The register in `docs/Decision-Log.md` is generated from `docs/decisions/*.md`. Four fragments
(document-automation assembly engine, document-automation template model, and two Custodian
fragments) were authored starting with a Markdown title instead of frontmatter. `parseAdrFile`
looked for the `---` fence on the first line, did not find one, and returned a record with empty
`status`, `date`, and `area` and the whole fragment — title included — as the body. The register
line then rendered as `- **ADR-NNNN** ·  ·  — # <title>`. Nothing threw, so it merged.

## Files this stream touches

| Area               | Files                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Assembler          | `tooling/doc-fragments/adr-file.mjs`, `build-decisions.mjs`                                                      |
| Assembler tests    | `tooling/doc-fragments/adr-file.test.mjs`, `decisions-corpus.test.mjs` (new)                                     |
| Governance gate    | `tooling/lint-decisions.mjs` (new), `package.json` (`lint:decisions`), `.github/workflows/gate.yml`              |
| Repaired decisions | `docs/decisions/0210-*.md`, `0211-*.md`, `0212-*.md`, `0213-*.md`                                                |
| Fragments          | `docs/decisions/pending/decision-fragment-validation-at-fold-time.md`, `changelog.d/decision-register-repair.md` |

**Overlap risk:** `package.json` (one script line) and `.github/workflows/gate.yml` (one line in the
governance step) are the only shared files. `docs/Decision-Log.md` and `CHANGELOG.md` are
deliberately **not** touched — they are rendered output, and only the docs-sync stream edits those on
a branch.

## How the register gets repaired

The four numbered files carry the authored body verbatim, so nothing had to be recovered from git
history: the repair is correct frontmatter plus a body that opens with the decision rather than a
title. The rendered register is left to the mechanism that owns it — the `assemble-docs` workflow
runs `build-decisions.mjs` on every push to `main`, and its unconditional `regenerateRegister()` will
re-render the four bullets from the corrected files and deliver them as the usual auto-merging
assembly pull request. Verified locally by running the assembler and reverting its output.

## Owner decisions recorded (2026-08-04)

- **Assembly engine** — accepted as recommended: the in-house TypeScript OOXML merge is the decision;
  docxtemplater's core stays a scoped fallback behind the same port.
- **Template model, merge-field syntax** — `{{key}}` is the one canonical form once a template is
  registered, and `MERGEFIELD` is not a second supported syntax. Detection and reporting of
  `MERGEFIELD` constructs are **always on**; conversion to the brace form is **opt-in**, run only on
  an explicit request rather than as a side effect of registration; and confirmed
  name-to-key mappings accumulate in a **per-firm field-mapping library** so later imports reuse
  earlier confirmations. Content controls stay a deferred seam.
- **Data conversion posture (new pending fragment)** — the general principle the template-model
  amendment instantiates: conversion of user data into the platform is **consensual and guided**
  everywhere it happens. Detection and reporting always on, conversion opt-in and never silent, the
  product supplying input/guidance/feedback at the decision, and repeated confirmations accumulating
  as reusable per-firm mappings so a bulk migration converges on one pass. Slug:
  `consensual-guided-data-conversion`.
- **Template model, macro handling** — macro-bearing uploads are **accepted and stripped**, a
  deviation from the recommendation to refuse them outright: registration removes `vbaProject.bin`
  with its content-type entries and relationships, then re-verifies the stripped package sniffs as a
  clean macro-free `.docx`. Flagged in the entry as security-boundary code requiring adversarial
  tests.
- **Custodian register model** — accepted as recommended, all three: packet/item hierarchy, mandatory
  Directory owner link, per-firm `system` holding matter for matterless scans.

**Not recorded:** the Custodian retention posture (`0213`) carries no owner decision, so it keeps a
`Proposed — owner decision pending` status with its fields and body now complete. Its open question —
whether a jurisdiction catalog is wanted, and which jurisdiction first — is still open.

## Adjacent finding, not fixed here

`CHANGELOG.md` carries a doubled bullet (`- - **The Oxlint ruleset …**`) from the same class of
defect: `foldFragments` prefixes each fragment body with `- `, and that fragment was authored with a
leading `- ` of its own. Left alone because a branch must not edit `CHANGELOG.md`; it needs either a
docs-sync pass or the same kind of fragment guard on the changelog assembler.
