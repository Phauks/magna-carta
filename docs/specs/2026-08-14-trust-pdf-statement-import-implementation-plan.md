# Trust — PDF bank-statement import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Design:** [`2026-08-14-trust-pdf-statement-import-design.md`](2026-08-14-trust-pdf-statement-import-design.md)
**Extends:** the three-way reconciliation built under ADR-0246 — [`2026-07-09-slice-3-2-trust-jurisdiction-schema-implementation-plan.md`](2026-07-09-slice-3-2-trust-jurisdiction-schema-implementation-plan.md)
**Goal:** Let a firm import the bank statement it actually has — a PDF — into the bank side of the reconciliation, without ever letting a parse move money and without ever storing a reading the platform cannot re-derive.

**Architecture:** No new package and no new crate. `crates/pdf-core` exposes the positioned text its observation pass already computes; `@magna-carta/trust` grows a statement-source seam, a PDF row assembler, and the footing check; `apps/worker` grows the extraction orchestration and two routes beside the delimited pair that already exist. The heavy half — recognition of a scanned statement — runs in the OCR Container that is already deployed, behind the job shape the conversion subsystem already has.

**Tech stack:** Rust (`pdf-core`, WASM + native), TypeScript, Drizzle ORM (per-firm schema), SQLite/D1, R2, Cloudflare Queues + Durable Objects, Hono + `@hono/zod-openapi`, Vitest.

---

## Before anything: this plan does not start until the flags are answered

The design carries nine owner flags (**S1–S9**). Four of them decide what gets built rather than how:

- **S1** (footing failure refuses, or may be overridden) decides whether slice 2 has an override path at all.
- **S2** (may a scanned statement be imported) decides whether slice 3 exists.
- **S5** and **S6** (statement retention, and whether it applies to the delimited path) decide the shape of slice 1, which is the retention slice.

**Do not build a flagged value as a constant.** Where a flag ships with a recommended default, build the mechanism and put the default behind a firm setting through the scoped setting resolver, and record the setting in force on the row that depended on it.

---

## Global constraints

- **Golden rule 8 — this plan is downstream of a spec, and any decision it discovers becomes an ADR fragment in the same commit.** A plan is not a place to settle a new question.
- **Golden rule 12 — no shorthand.** `statementLayoutProfile`, not `layoutProfile` abbreviated further; `extractionArtifact`, not `artifact`; "the data-access layer", never "the DAL".
- **Golden rule 13 — no process references in source.** No ADR numbers, no "spec section N", no "slice N" in code, tests, config, or OpenAPI `description`s. A forward-looking schedule note is the one allowance.
- **Golden rule 2 — no emojis**, anywhere, including commit messages.
- **Golden rule 3 — bulk content to R2, never D1.** The PDF and the extraction artifact are R2 objects; D1 holds handles, digests, and the parsed rows.
- **Golden rule 10 — nothing heavy in a request handler.** The native extraction is a bounded WASM call and may stay inline; recognition is a Container round trip and rides a job.
- **Golden rule 14 — no new C or C++ surface.** This plan introduces no dependency at all. If a task finds itself wanting a PDF table library, it has gone wrong: stop, and raise it as an owner question.
- **Every trust table named here stays append-only.** `trust_bank_statement` and `trust_bank_statement_line` carry `RAISE(ABORT)` triggers. New columns arrive by `ALTER TABLE ADD COLUMN` — nullable, no default expression — which SQLite performs without a table rebuild and which leaves the triggers intact. **Widen no existing CHECK.**
- **A new migration is registered in `apps/worker/src/per-firm-migrations.ts` as well as the drizzle journal**, and takes the next monotonic timestamped id above the current head at the time of the task.
- **`Money` in, `toMinor` integers at the SQL boundary.** No floats and no rounding, anywhere in the parse.
- **D1 has no interactive transactions** — read before composing a batch.
- **The composition guard is not touched, and nothing in this plan composes a ledger entry.** If a task adds an import to `composition-guard.ts`, `movements.ts`, `transfer.ts`, or `firm-funds.ts` from anything on the import path, it has gone wrong.
- **Every write route carries idempotency and rides the chokepoint**, and every new refusal code gets its entry in the trust problem-type map, its operation in the conformance not-vacuous list, and its metric in the telemetry catalog.

---

## Slice ordering

| Slice | Ships                                                                                                                                                   | Useful alone because                                                                                                                                                                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | Statement provenance: the retained source object, its digest on the statement row, the extraction-artifact object, and the parser and profile stamps    | It fixes an existing defect on its own. A delimited-imported statement retains nothing today, so an imported statement cannot be re-derived from anything the platform kept. This slice makes `imported` mean one thing, and every later slice writes into a record that can already hold provenance |
| **2** | The born-digital path: positioned extraction in `pdf-core`, geometric column inference, row assembly, the footing check, the preview and confirm routes | This is the statement the overwhelming majority of firms have. It ships a complete import for a PDF downloaded from online banking, with no Container and no recognition anywhere in it                                                                                                              |
| **3** | The scanned path: per-page composite routing into the existing OCR Container, the extraction job, and per-line source and confidence provenance         | Adds the firms with paper or faxed statements. Gated on **S2**; if the answer is no, this slice is not built and recognition remains an aid to a member typing a statement                                                                                                                           |
| **4** | Layout profiles that accumulate: the per-firm profile keyed by a structural fingerprint, its confirmation surface, and its editability                  | Turns a monthly interrogation into a monthly click. It is the last slice because it is an optimization of a flow that must be correct first, and because a stored profile that was wrong is worse than no profile                                                                                    |
| **5** | The interface, the user documentation, and the load-profile fixtures                                                                                    | The surface a firm actually uses. Documentation lands with it, never before it                                                                                                                                                                                                                       |

Slices 2 and 3 share `packages/trust/src/` and must not run concurrently under different owners. Slice 1 is independent of both and may run first or in parallel with slice 2's Rust half.

---

## Slice 1 — provenance a reconciliation can be re-derived from

- [ ] **Task 1.1 — Name the object class.** Add a firm-scoped object class for a retained bank statement, and a second for its extraction artifact, to `@magna-carta/object-dimensions`. Firm-scoped, not matter-scoped: a trust account spans matters and the object belongs to none of them. Adding a token is safe; renaming one orphans the dimension on every object already written, so get the names right in this task.
- [ ] **Task 1.2 — Retain the source.** Route the uploaded statement through the ordinary ingest chokepoint so it is malware-scanned like every inbound file, content-address it by digest, and stamp it. **Build no second upload door into the trust subsystem.**
- [ ] **Task 1.3 — Migration: the provenance columns.** `ALTER TABLE trust_bank_statement ADD COLUMN` for the source-object handle, the source digest, the extraction-artifact handle, the parser version, and the resolved-profile handle. All nullable — a statement a member typed has none of them, and a statement imported before this slice can never acquire them. Register it in the journal and in `per-firm-migrations.ts`.
- [ ] **Task 1.4 — Migration: the line locator.** `ALTER TABLE trust_bank_statement_line ADD COLUMN` for the page index and the line index within the extraction artifact, plus the read source (native text layer or recognition) and the confidence where recognition produced it. `source_row_number` stays as it is and keeps meaning a row in a delimited file; do not overload it.
- [ ] **Task 1.5 — Carry the delimited path onto the same mechanism** (gated on **S6**). The confirmed file text is retained as a source object with its digest on the row, so `source = 'imported'` means one thing. State plainly, in the package's own documentation, that statements imported before this slice cannot be re-derived — do not imply otherwise.
- [ ] **Task 1.6 — Retention and erasure** (gated on **S5**). Register the statement object in the personal-data registry and state its retention. A client's bank statement carries names, amounts, and dates; whether a subject erasure request reaches it while a trust-record retention obligation runs is the owner's answer, and it belongs in the registry rather than in a comment.
- [ ] **Task 1.7 — Fitness.** Extend the trust fitness suite to re-prove over stored rows that every statement with `source = 'imported'` written after this slice carries a source digest, and that no line's locator points outside its statement's artifact.

## Slice 2 — the born-digital statement

- [ ] **Task 2.1 — Expose positioned text from `pdf-core`.** A positioned extraction beside `extract_pdf_text`, over the same `observe_page` pass in `textpos.rs` — lines with their bounding boxes rather than lines alone. The existing single-column reading order stays exactly as it is and keeps serving the keyword index; this is an addition, not a change. Bind it through `wasm.rs` and re-export it from `@magna-carta/pdf`. The decompression guard and the page ceiling apply unchanged.
- [ ] **Task 2.2 — Column inference, pure and testable.** Cluster line boxes into vertical bands and classify each band by the shape of its cells: civil dates, currency amounts, free text. **No bank names, no institution list, no positional fallback.** A layout that does not resolve is a refusal that names what was found — the page count, the bands detected, and whether the text was native — never a guess at which column held the money. Pure function over positioned lines; no database, no `env`.
- [ ] **Task 2.3 — Row assembly.** Turn classified bands into candidate rows, joining wrapped description lines to the row above them by vertical proximity. Reuse the delimited importer's money and date handling verbatim: `normalizeAmountText`, `parseCivilDate` with the caller's **stated** convention, `fromDecimal` then `toMinor`, and `isValidCalendarDate` as the one date check. A date the parser cannot read in the stated convention is a rejected row, never a date reinterpreted under another convention.
- [ ] **Task 2.4 — The footing check.** Read the opening balance, the closing balance, and the running-balance column where one exists. Assert `opening + deposits - withdrawals = closing` in minor units. On failure, report the difference and — where a running balance was read — the first line at which it diverged. This is the gate that makes the whole design safe; it is not optional and it is not a warning (subject to **S1**).
- [ ] **Task 2.5 — The preview.** A `previewTrustPdfStatementImport` beside `previewTrustStatementImport`, reporting the same shape a delimited preview reports — resolved roles, rows, rejections with reasons, totals, period — plus the balances read and the footing result, and a fingerprint over exactly the parsed rows. It stores nothing and touches no database, so it is safe to run on a file nobody has decided about.
- [ ] **Task 2.6 — The confirmation.** Re-derive the rows from the **retained extraction artifact** rather than re-extracting the PDF, refuse unless the fingerprint still matches, and compose through the existing `composeTrustBankStatement` with `source = 'imported'`. Do not fork the statement composer: the period bounds, the currency match, the positive-amount rule, and the line-inside-period rule are already there and must stay in one place.
- [ ] **Task 2.7 — Routes.** `POST /api/v1/trust/bank-statements/import/pdf/preview` and `.../import/pdf`, modelled exactly on the delimited pair: required idempotency key on both, the preview `audited: false` because it stores nothing, `trust:manage` (subject to **S7**), and the new refusal codes mapped in the trust problem-type map. Re-emit the OpenAPI snapshot and regenerate the client in the same commit.
- [ ] **Task 2.8 — Tests.** Fixture statements as committed PDFs covering: two-column and three-column money layouts, a running-balance column and none, a wrapped description, a page footer that looks like a row, a statement that does not foot, an unresolvable layout, and an overdrawn closing balance (which is signed and must be recordable — refusing to record it would refuse the condition reconciliation exists to catch).

## Slice 3 — the scanned statement (gated on S2)

- [ ] **Task 3.1 — Route pages, not documents.** Use the same `pdf-core` gate the search extractor uses to decide per page whether recognition has anything to add, so the extractor and the recognizer can never disagree about a page. A scan appended to a born-digital statement is one file with pages of both kinds.
- [ ] **Task 3.2 — Reach the existing OCR Container.** Through the `OCR_SERVICE` binding, validated at the trust boundary exactly as `search/text-extraction.ts` validates it. **Build no second recognition path**, and add no engine, no adapter, and no model.
- [ ] **Task 3.3 — The extraction job.** Recognition is not request work. Ride the job shape the conversion subsystem already has — a coordinator Durable Object keyed to the firm, a queue, a poll endpoint and a WebSocket subscription resolving through one shared progress resolver. Do not grow a second job mechanism.
- [ ] **Task 3.4 — Provenance on every recognized line.** The engine's confidence and its provenance triple (engine version, model version, platform) are retained in the artifact and stamped on the line. They order the member's review and explain a footing failure; **they gate nothing**. A task that adds a confidence threshold has reintroduced the failure mode this design exists to prevent.
- [ ] **Task 3.5 — Tests.** A rasterized fixture statement, asserting that a recognized line carries its source and confidence, that a mixed-page document reads both halves, and that the footing check refuses a deliberately corrupted digit.

## Slice 4 — layout profiles that accumulate

- [ ] **Task 4.1 — The profile.** A per-firm statement layout profile keyed by a **structural fingerprint of the layout**, never by a bank name — a name is not reliably in the file and is not a stable key. It stores the resolved column roles and the stated date convention.
- [ ] **Task 4.2 — Confirm once, reuse thereafter.** The first statement of a layout asks; the next resolves silently. This is the accumulate rule the document-automation field-mapping library already instantiates, so follow that shape rather than inventing a second one.
- [ ] **Task 4.3 — Visible and editable, never an invisible cache.** A stored profile that was wrong stays wrong until somebody can find it and correct it. It is listable, readable, and editable, and the profile in force is recorded on the statement row (slice 1 already added the column).

## Slice 5 — surface, documentation, fixtures

- [ ] **Task 5.1 — The import surface**, through the design system only: no raw CSS, no off-token values, no direct headless-primitive imports, Lucide icons, no emojis. The preview is the decision screen — resolved roles, rows, rejections with reasons, totals, the footing result — and it is where the platform earns the confirmation it asks for.
- [ ] **Task 5.2 — Mark indistinguishable candidates in the matching surface.** When two or more suggestions share every signal, say so, so a member knows they are choosing arbitrarily rather than choosing. Display only; nothing new is stored.
- [ ] **Task 5.3 — User documentation** in `docs/user/`, and it says the true things: the platform does not prevent a trust overdraft, an unmatched line is an outcome rather than a failure, and an aged outstanding check will not be suggested although it is still counted.
- [ ] **Task 5.4 — Load-profile fixtures** for a statement at the 2,000-line ceiling, so the import is perf-tested against the harness as built rather than after a firm finds the edge.

---

## Definition of done

Each slice is done when its tests pass, `pnpm check:scoped` is clean on its diff, the OpenAPI snapshot and the generated client are regenerated in the same commit as any route change, the roadmap node for trust reconciliation reflects what actually shipped, and the changelog and decision fragments are committed alongside — never a hand edit of `CHANGELOG.md`, the Decision-Log register, `STATUS.md`, or `docs/now.md`.
